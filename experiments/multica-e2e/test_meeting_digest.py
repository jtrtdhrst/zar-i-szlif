import unittest

from meeting_digest import build_meeting_digest


class MeetingDigestTests(unittest.TestCase):
    def test_strips_whitespace_from_title_attendees_and_actions(self):
        digest = build_meeting_digest(
            "  Weekly Sync  ",
            ["  Alice  ", " Bob "],
            ["  Send notes ", " book room  "],
        )
        self.assertEqual(digest["title"], "Weekly Sync")
        self.assertEqual(digest["attendees"], ["Alice", "Bob"])
        self.assertEqual(digest["actions"], ["Send notes", "book room"])

    def test_attendees_deduplicate_case_insensitively_keeping_first_capitalization(self):
        digest = build_meeting_digest(
            "Planning",
            ["Alice", "alice", "ALICE", "Bob", "bob"],
            [],
        )
        self.assertEqual(digest["attendees"], ["Alice", "Bob"])

    def test_attendees_preserve_first_seen_order(self):
        digest = build_meeting_digest(
            "Ordering",
            ["Zoe", "Adam", "Mia", "zoe"],
            [],
        )
        self.assertEqual(digest["attendees"], ["Zoe", "Adam", "Mia"])

    def test_actions_preserve_order_and_are_not_deduplicated(self):
        digest = build_meeting_digest(
            "Actions",
            [],
            ["first", "second", "first", "third"],
        )
        self.assertEqual(digest["actions"], ["first", "second", "first", "third"])

    def test_blank_attendees_and_actions_are_dropped(self):
        digest = build_meeting_digest(
            "Blanks",
            ["Alice", "", "   ", "\t", "Bob"],
            ["", "   ", "do it", "\t"],
        )
        self.assertEqual(digest["attendees"], ["Alice", "Bob"])
        self.assertEqual(digest["actions"], ["do it"])
        self.assertEqual(digest["action_count"], 1)

    def test_empty_title_raises_value_error(self):
        with self.assertRaises(ValueError):
            build_meeting_digest("", ["Alice"], ["do it"])

    def test_whitespace_only_title_raises_value_error(self):
        with self.assertRaises(ValueError):
            build_meeting_digest("   \t  ", ["Alice"], [])

    def test_invalid_title_type_raises_type_error(self):
        for invalid in (None, 123, ["Title"]):
            with self.subTest(title=invalid):
                with self.assertRaises(TypeError):
                    build_meeting_digest(invalid, [], [])

    def test_invalid_attendee_type_raises_type_error(self):
        for invalid in (None, 42, ["Alice"]):
            with self.subTest(attendee=invalid):
                with self.assertRaises(TypeError):
                    build_meeting_digest("Title", ["Alice", invalid], [])

    def test_invalid_action_type_raises_type_error(self):
        for invalid in (None, 3.14, {"action": 1}):
            with self.subTest(action=invalid):
                with self.assertRaises(TypeError):
                    build_meeting_digest("Title", [], ["do it", invalid])

    def test_input_sequences_are_not_mutated(self):
        attendees = ["  Alice  ", "alice", "", "Bob"]
        actions = ["  first ", "first", "", " second  "]
        attendees_before = list(attendees)
        actions_before = list(actions)
        build_meeting_digest("  Title  ", attendees, actions)
        self.assertEqual(attendees, attendees_before)
        self.assertEqual(actions, actions_before)

    def test_zero_actions(self):
        digest = build_meeting_digest("No actions", ["Alice"], [])
        self.assertEqual(digest["actions"], [])
        self.assertEqual(digest["action_count"], 0)

    def test_returns_all_required_keys_and_counts(self):
        digest = build_meeting_digest("Sync", ["Alice"], ["one", "two"])
        self.assertEqual(
            set(digest),
            {"title", "attendees", "actions", "action_count"},
        )
        self.assertEqual(digest["action_count"], len(digest["actions"]))
        self.assertEqual(digest["action_count"], 2)


if __name__ == "__main__":
    unittest.main()
