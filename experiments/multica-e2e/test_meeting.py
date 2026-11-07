import unittest

from meeting import meeting_summary


class MeetingSummaryTests(unittest.TestCase):
    def test_trims_whitespace(self):
        self.assertEqual(meeting_summary(["  hello  ", " world "]), "1. hello\n2. world")

    def test_skips_empty_strings(self):
        self.assertEqual(
            meeting_summary(["first", "", "   ", "second"]),
            "1. first\n2. second",
        )

    def test_preserves_ordering(self):
        self.assertEqual(
            meeting_summary(["alpha", "beta", "gamma"]),
            "1. alpha\n2. beta\n3. gamma",
        )

    def test_no_items(self):
        self.assertEqual(meeting_summary([]), "")

    def test_only_blank_items(self):
        self.assertEqual(meeting_summary(["", "   ", "\t"]), "")


if __name__ == "__main__":
    unittest.main()
