import os
import json
import unittest
from html.parser import HTMLParser

os.environ.setdefault("SECRET_KEY", "test-only-secret")

from app import app, games, socketio


class PublicLobbyTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        games.clear()
        self.client = app.test_client()

    def tearDown(self):
        games.clear()

    def create_game(self, host="Host", public=False):
        data = {"host_name": host}
        if public:
            data["public"] = "on"
        response = self.client.post("/create", data=data)
        self.assertEqual(response.status_code, 302)
        return response.location.rsplit("/", 1)[1]

    def test_private_by_default_and_joinable_by_code(self):
        code = self.create_game("Private host")
        self.assertFalse(games[code]["public"])
        self.assertNotIn(b"Private host", self.client.get("/public-games").data)
        response = app.test_client().post(
            "/join", data={"game_code": code.lower(), "player_name": "Guest"}
        )
        self.assertEqual(response.location, f"/game/{code}")
        self.assertIn("Guest", games[code]["players"])

    def test_public_game_discovery_and_join(self):
        code = self.create_game("Public host", public=True)
        home = self.client.get("/").get_data(as_text=True)
        self.assertIn("Public host", home)
        self.assertIn(f"/join?game_code={code}", home)
        self.assertIn("1 player · In lobby", home)
        guest = app.test_client()
        join_page = guest.get(f"/join?game_code={code}")
        self.assertEqual(join_page.status_code, 200)
        self.assertIn(f'value="{code}"', join_page.get_data(as_text=True))
        response = guest.post("/join", data={"game_code": code, "player_name": "Guest"})
        self.assertEqual(response.location, f"/game/{code}")
        self.assertEqual(guest.get(response.location).status_code, 200)
        self.assertIn(b"2 players", guest.get("/public-games").data)
        games[code]["started"] = True
        self.assertIn(b"In progress", guest.get("/public-games").data)

    def test_inactive_empty_and_legacy_games_are_hidden(self):
        inactive = self.create_game("Inactive host", public=True)
        games[inactive]["active"] = False
        empty = self.create_game("Empty host", public=True)
        games[empty]["players"] = []
        legacy = self.create_game("Legacy host", public=True)
        del games[legacy]["public"]
        listing = self.client.get("/public-games")
        self.assertIn(b"No public games yet", listing.data)
        self.assertNotIn(b"host", listing.data)
        self.assertEqual(listing.headers["Cache-Control"], "no-store")

    def test_disconnected_last_player_removes_public_listing(self):
        code = self.create_game("Leaving host", public=True)
        connection = socketio.test_client(app, flask_test_client=self.client)
        connection.disconnect()
        self.assertFalse(games[code]["active"])
        self.assertNotIn(b"Leaving host", self.client.get("/public-games").data)

    def test_stale_links_and_duplicate_names_are_rejected(self):
        code = self.create_game(public=True)
        response = self.client.post("/join", data={"game_code": code, "player_name": "Host"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(games[code]["players"], ["Host"])
        games[code]["active"] = False
        self.assertEqual(self.client.get(f"/join?game_code={code}").status_code, 302)
        self.assertEqual(self.client.get("/join?game_code=MISSING").status_code, 302)
        response = self.client.post("/join", data={"game_code": code, "player_name": "Guest"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(games[code]["players"], ["Host"])

    def test_host_names_are_escaped_in_listing(self):
        self.create_game('<script>alert("hi")</script>', public=True)
        listing = self.client.get("/public-games").get_data(as_text=True)
        self.assertNotIn("<script>", listing)
        self.assertIn("&lt;script&gt;", listing)

    def test_game_configuration_preserves_names_in_json(self):
        class ConfigParser(HTMLParser):
            attributes = None

            def handle_starttag(self, tag, attrs):
                attributes = dict(attrs)
                if attributes.get("id") == "game-config":
                    self.attributes = attributes

        host = 'Host "Ace" O\'Brien'
        code = self.create_game(host, public=True)
        parser = ConfigParser()
        parser.feed(self.client.get(f"/game/{code}").get_data(as_text=True))
        self.assertEqual(json.loads(parser.attributes["data-players"]), [host])
        self.assertEqual(json.loads(parser.attributes["data-scores"]), {host: 0})


if __name__ == "__main__":
    unittest.main()
