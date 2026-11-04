import unittest

from game import Mole, WhackAMole, Wrist


class GameRulesTest(unittest.TestCase):
    def test_fast_punch_scores_once_and_still_hand_does_not(self):
        game = WhackAMole(punch_speed=.75)
        game.start(100)
        game.mole = Mole(.5, .5, 100)
        self.assertIsNone(game.update({"左手": Wrist(.2, .5, 0)}, 100.1))
        self.assertEqual(game.update({"左手": Wrist(.5, .5, 0)}, 100.2), "左手")
        self.assertEqual(game.score, 1)
        game.mole = Mole(.5, .5, 100.2)
        self.assertIsNone(game.update({"左手": Wrist(.5, .5, 0)}, 100.3))
        self.assertEqual(game.score, 1)

    def test_pause_freezes_clock_and_mole(self):
        game = WhackAMole(duration=10, mole_seconds=1)
        game.start(100)
        game.pause(100.4)
        game.update({}, 110)
        self.assertEqual(game.misses, 0)
        game.resume(110)
        self.assertAlmostEqual(game.remaining(110), 9.6)
        game.update({}, 110.5)
        self.assertEqual(game.misses, 0)
        game.update({}, 110.7)
        self.assertEqual(game.misses, 1)


if __name__ == "__main__":
    unittest.main()
