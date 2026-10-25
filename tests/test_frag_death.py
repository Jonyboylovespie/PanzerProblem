import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-only-secret")

from app import app, games, socketio


class FragDeathTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        client = app.test_client()
        response = client.post("/create", data={"host_name": "Victim"})
        self.code = response.location.rsplit("/", 1)[1]
        self.game = games[self.code]
        self.game["started"] = True
        self.game["active"] = False  # Keep background snapshots out of event assertions.
        self.game["players"] = ["Victim", "Attacker", "Bystander"]
        self.game["tanks"] = {
            name: {"x": 35, "y": 35, "angle": 0, "weapon": "frag", "alive": True}
            for name in self.game["players"]
        }
        self.game["bullets"] = {
            "hit": self.bullet("Attacker", "default", 35, 35),
            "victim_frag": self.bullet("Victim", "frag", 80, 90),
            "other_frag": self.bullet("Bystander", "frag", 160, 170),
        }
        self.connection = socketio.test_client(app, flask_test_client=client)
        self.connection.emit("join", {"game_code": self.code, "player_name": "Victim"})
        self.connection.get_received()

    def tearDown(self):
        self.connection.disconnect()
        games.pop(self.code, None)

    @staticmethod
    def bullet(shooter, weapon_type, x, y):
        return {"shooter": shooter, "weapon_type": weapon_type,
                "x": x, "y": y, "vx": 150, "vy": 0, "lifetime": 10}

    def hit(self, **extra):
        self.connection.emit("bullet_hit_tank", {
            "game_code": self.code, "bullet_id": "hit", "victim_name": "Victim", **extra,
        })

    def fragments(self, shooter):
        return [bullet for bullet in self.game["bullets"].values()
                if bullet["shooter"] == shooter and bullet["weapon_type"] == "fragment"]

    def assert_explosion(self, shooter, x, y):
        fragments = self.fragments(shooter)
        self.assertGreaterEqual(len(fragments), 15)
        self.assertLessEqual(len(fragments), 30)
        for fragment in fragments:
            self.assertEqual((fragment["x"], fragment["y"]), (x, y))
            self.assertEqual(fragment["lifetime"], 1.5)
            self.assertAlmostEqual((fragment["vx"] ** 2 + fragment["vy"] ** 2) ** 0.5, 300)

    def test_death_detonates_launched_frag_at_client_position_and_broadcasts(self):
        self.hit(frag_x=120, frag_y=130)
        self.assertFalse(self.game["tanks"]["Victim"]["alive"])
        self.assertEqual(self.game["tanks"]["Victim"]["weapon"], "default")
        self.assertNotIn("victim_frag", self.game["bullets"])
        self.assertIn("other_frag", self.game["bullets"])
        self.assert_explosion("Victim", 120, 130)
        events = {event["name"]: event["args"][0] for event in self.connection.get_received()}
        self.assertEqual(events["update_bullets"], self.game["bullets"])
        self.assertFalse(events["update_tanks"]["Victim"]["alive"])
        original_bullets = self.game["bullets"].copy()
        self.hit(frag_x=120, frag_y=130)
        self.assertEqual(self.game["bullets"], original_bullets)

    def test_death_falls_back_to_stored_frag_position(self):
        self.hit()
        self.assert_explosion("Victim", 80, 90)

    def test_unfired_frag_weapon_does_not_explode_on_death(self):
        del self.game["bullets"]["victim_frag"]
        self.hit()
        self.assertFalse(self.game["tanks"]["Victim"]["alive"])
        self.assertEqual(self.fragments("Victim"), [])
        self.assertEqual(set(self.game["bullets"]), {"other_frag"})

    def test_frag_impact_and_victims_launched_frag_both_explode(self):
        self.game["bullets"]["hit"]["weapon_type"] = "frag"
        self.hit(frag_x=120, frag_y=130)
        self.assert_explosion("Attacker", 35, 35)
        self.assert_explosion("Victim", 120, 130)

    def test_self_hit_frag_explodes_once(self):
        del self.game["bullets"]["hit"]
        self.hit(bullet_id="victim_frag")
        self.assert_explosion("Victim", 35, 35)
        self.assertNotIn("victim_frag", self.game["bullets"])

    def test_death_fragments_can_kill_another_player(self):
        self.hit()
        fragment_id = next(key for key, bullet in self.game["bullets"].items()
                           if bullet["shooter"] == "Victim")
        with patch("app.schedule_win_if_survives") as schedule_win:
            self.hit(bullet_id=fragment_id, victim_name="Bystander", frag_x=180, frag_y=190)
        self.assertFalse(self.game["tanks"]["Bystander"]["alive"])
        self.assert_explosion("Bystander", 180, 190)
        schedule_win.assert_called_once_with(self.code, "Attacker")

    def test_manual_detonation_still_uses_client_position(self):
        self.connection.emit("shoot", {
            "game_code": self.code, "player_name": "Victim", "frag_x": 120, "frag_y": 130,
        })
        self.assertTrue(self.game["tanks"]["Victim"]["alive"])
        self.assert_explosion("Victim", 120, 130)


if __name__ == "__main__":
    unittest.main()
