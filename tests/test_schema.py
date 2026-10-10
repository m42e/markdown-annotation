import json
import unittest
from pathlib import Path

import jsonschema


ROOT = Path(__file__).resolve().parents[1]


def entry(operation, kind=None, selection=None, **fields):
    if kind is None:
        kind = "comment" if operation == "comment" else "text-edit"
    result = {
        "id": "00000000-0000-0000-0000-000000000001",
        "kind": kind,
        "operation": operation,
        "createdAt": "2026-10-10T00:00:00Z",
        "section": {"heading": "Example"},
        "selection": selection if selection is not None else {"text": "word"},
        "events": [
            {
                "eventId": "00000000-0000-0000-0000-000000000002",
                "type": "created",
                "timestamp": "2026-10-10T00:00:00Z",
            }
        ],
    }
    result.update(fields)
    return result


def payload(item):
    return {
        "schemaVersion": "2.0.0",
        "createdAt": "2026-10-10T00:00:00Z",
        "updatedAt": "2026-10-10T00:00:00Z",
        "entries": [item],
    }


class AnnotationSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))
        cls.format_checker = jsonschema.FormatChecker()
        cls.validator = jsonschema.Draft202012Validator(
            cls.schema, format_checker=cls.format_checker
        )

    def assert_valid(self, item):
        self.assertTrue(self.validator.is_valid(payload(item)), item)

    def assert_invalid(self, item):
        self.assertFalse(self.validator.is_valid(payload(item)), item)

    def test_schema_is_valid_draft_2020_12(self):
        jsonschema.Draft202012Validator.check_schema(self.schema)

    def test_uuid_and_datetime_formats_are_checked(self):
        invalid_id = entry("delete")
        invalid_id["id"] = "not-a-uuid"
        self.assert_invalid(invalid_id)

        invalid_event = entry("delete")
        invalid_event["events"][0]["eventId"] = "not-a-uuid"
        self.assert_invalid(invalid_event)

        invalid_timestamp = entry("delete")
        invalid_timestamp["events"][0]["timestamp"] = "2026-10-10"
        self.assert_invalid(invalid_timestamp)

        bad_payload_timestamp = payload(entry("delete"))
        bad_payload_timestamp["updatedAt"] = "2026-10-10"
        self.assertFalse(self.validator.is_valid(bad_payload_timestamp))

    def test_all_operations_have_valid_contracts(self):
        self.assert_valid(entry("comment", comment="Consider this wording."))
        self.assert_valid(entry("delete"))
        self.assert_valid(entry("add", value="new text"))
        self.assert_valid(
            entry(
                "add",
                value="before ",
                selection={"text": "word", "placement": "before"},
            )
        )
        self.assert_valid(entry("reword", value="replacement"))
        self.assert_invalid(entry("add"))
        self.assert_invalid(entry("reword"))

    def test_kind_must_match_operation(self):
        self.assert_invalid(
            entry("comment", kind="text-edit", comment="A note.")
        )
        self.assert_invalid(entry("delete", kind="comment"))
        self.assert_invalid(entry("add", kind="comment", value="new"))
        self.assert_invalid(entry("reword", kind="comment", value="new"))

    def test_comment_requires_comment_and_nonempty_selection(self):
        self.assert_invalid(entry("comment"))
        missing_selection = entry("comment", comment="A note.")
        missing_selection.pop("selection")
        self.assert_invalid(missing_selection)
        self.assert_invalid(
            entry("comment", comment="A note.", selection={"text": ""})
        )

    def test_history_has_one_initial_created_event(self):
        base = entry("delete")
        first_created = base["events"][0]
        submitted = {
            "eventId": "00000000-0000-0000-0000-000000000003",
            "type": "submitted",
            "timestamp": "2026-10-10T00:00:01Z",
        }

        self.assert_invalid(dict(base, events=[submitted, first_created]))
        self.assert_invalid(
            dict(
                base,
                events=[
                    first_created,
                    dict(
                        first_created,
                        eventId="00000000-0000-0000-0000-000000000004",
                    ),
                ],
            )
        )
        self.assert_invalid(dict(base, events=[submitted]))

    def test_operation_specific_fields_are_enforced(self):
        self.assert_invalid(entry("comment", comment="A note.", value="extra"))
        self.assert_invalid(entry("delete", value="extra"))
        self.assert_valid(entry("delete", comment="Why this should be removed."))
        self.assert_invalid(
            entry("delete", selection={"text": "word", "placement": "before"})
        )
        self.assert_valid(entry("add", comment="Why this addition helps.", value="new"))
        self.assert_valid(
            entry("reword", comment="Why this wording is clearer.", value="new")
        )

    def test_empty_add_anchor_requires_explicit_boundary_context(self):
        self.assert_valid(
            entry(
                "add",
                value="Start",
                selection={"text": "", "prefix": "", "suffix": ""},
            )
        )
        self.assert_valid(
            entry(
                "add",
                value="Start: ",
                selection={"text": "", "prefix": "", "suffix": "Document"},
            )
        )
        self.assert_valid(
            entry(
                "add",
                value=" End",
                selection={"text": "", "prefix": "Document", "suffix": ""},
            )
        )
        self.assert_invalid(
            entry(
                "add",
                value="inside",
                selection={"text": "", "prefix": "before", "suffix": "after"},
            )
        )
        self.assert_invalid(
            entry("add", value="Start", selection={"text": "", "suffix": "Document"})
        )
        self.assert_invalid(
            entry(
                "delete",
                selection={"text": "", "prefix": "", "suffix": ""},
            )
        )
        self.assert_invalid(
            entry(
                "reword",
                value="replacement",
                selection={"text": "", "prefix": "", "suffix": ""},
            )
        )


if __name__ == "__main__":
    unittest.main()
