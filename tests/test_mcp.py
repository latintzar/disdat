"""Validate Figma serialization with an intercepted request and synthetic tokens."""
import importlib.util
import json
import pathlib
import unittest
from unittest.mock import MagicMock, patch

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "mcp" / "server.py"
SPEC = importlib.util.spec_from_file_location("disdat_tokens_mcp", SOURCE)
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class FigmaValuesTest(unittest.TestCase):
    def push(self, library):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true}'
        with patch.dict(SERVER.os.environ, {"FIGMA_TOKEN": "synthetic-test-token"}), \
                patch.object(SERVER, "_load_library", return_value=library), \
                patch.object(SERVER.urllib.request, "urlopen", return_value=response) as request:
            result = SERVER._tool_push_to_figma({"file_key": "synthetic-file"})
        return result, request

    def test_typed_values_remain_json_numbers_booleans_colors_and_strings(self):
        library = {
            "count": {"$type": "number", "$value": 500},
            "ratio": {"$type": "number", "$value": 0.85},
            "enabled": {"$type": "boolean", "$value": True},
            "paper": {"$type": "color", "$value": "#FFFFFF"},
            "radius": {"$type": "dimension", "$value": "12px"},
        }
        result, request = self.push(library)
        self.assertIn("Pushed 5 tokens", result)
        payload = json.loads(request.call_args.args[0].data)
        values = {var["name"]: (var["resolvedType"], value["value"])
                  for var, value in zip(payload["variables"], payload["variableModeValues"])}
        self.assertEqual(values["count"], ("FLOAT", 500))
        self.assertIs(type(values["count"][1]), int)
        self.assertEqual(values["ratio"], ("FLOAT", 0.85))
        self.assertIs(type(values["ratio"][1]), float)
        self.assertEqual(values["enabled"], ("BOOLEAN", True))
        self.assertEqual(values["paper"], ("COLOR", {"r": 1, "g": 1, "b": 1, "a": 1}))
        self.assertEqual(values["radius"], ("STRING", "12px"))

    def test_invalid_number_values_stop_before_the_network_request(self):
        for value in ("500", True, float("nan"), float("inf")):
            with self.subTest(value_type=type(value).__name__):
                result, request = self.push({"invalid": {"$type": "number", "$value": value}})
                self.assertIn("valid color, finite number", result)
                request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
