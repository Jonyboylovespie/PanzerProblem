import math
import os
import unittest

os.environ.setdefault("SECRET_KEY", "test-only-secret")

from app import app, bullet_spawn_position, games, generate_empty_maze, socketio


class BulletSpawnTests(unittest.TestCase):
    def setUp(self):
        self.game = {"maze": generate_empty_maze(1, 1), "cell_size": 70}

    def test_shots_near_each_wall_stay_on_the_near_side(self):
        cases = [
            (47.49, 35, 0, "x", 1, 67.5),
            (22.51, 35, math.pi, "x", -1, 2.5),
            (35, 47.49, math.pi / 2, "y", 1, 67.5),
            (35, 22.51, -math.pi / 2, "y", -1, 2.5),
        ]
        for x, y, angle, axis, direction, face in cases:
            with self.subTest(angle=angle):
                spawn = bullet_spawn_position(self.game, {"x": x, "y": y, "angle": angle})
                coord = spawn[0 if axis == "x" else 1]
                self.assertLess(direction * (coord - face), 0)
                self.assertGreater(math.hypot(spawn[0] - x, spawn[1] - y), 15)

    def test_clear_shots_keep_normal_muzzle_position(self):
        for angle in [0, math.pi / 2, math.pi, -math.pi / 2, math.pi / 4]:
            with self.subTest(angle=angle):
                x, y = bullet_spawn_position(self.game, {"x": 35, "y": 35, "angle": angle})
                self.assertAlmostEqual(x, 35 + 25 * math.cos(angle))
                self.assertAlmostEqual(y, 35 + 25 * math.sin(angle))

    def test_diagonal_shot_cannot_skip_a_wall_corner(self):
        x, y = bullet_spawn_position(self.game, {"x": 49, "y": 49, "angle": math.pi / 4})
        self.assertLess(x, 67.5)
        self.assertLess(y, 67.5)
        self.assertAlmostEqual(x, y)

    def test_shoot_event_broadcasts_safe_spawn_at_an_interior_wall(self):
        app.config.update(TESTING=True)
        client = app.test_client()
        response = client.post("/create", data={"host_name": "Shooter"})
        code = response.location.rsplit("/", 1)[1]
        game = games[code]
        game["maze"] = generate_empty_maze(2, 1)
        game["maze"][0][0]["right"] = True
        game["maze"][0][1]["left"] = True
        game["started"] = True
        game["tanks"]["Shooter"].update(x=47.49, y=35, angle=0)
        connection = socketio.test_client(app, flask_test_client=client)
        try:
            connection.emit("join", {"game_code": code, "player_name": "Shooter"})
            connection.get_received()
            connection.emit("shoot", {"game_code": code, "player_name": "Shooter"})
            updates = [event for event in connection.get_received() if event["name"] == "update_bullets"]
            bullet = next(iter(updates[-1]["args"][0].values()))
            self.assertLess(bullet["x"], 67.5)
            self.assertEqual(bullet["y"], 35)
            self.assertEqual(bullet["vx"], 300)
        finally:
            connection.disconnect()
            games.pop(code, None)


if __name__ == "__main__":
    unittest.main()
