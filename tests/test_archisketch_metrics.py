"""Source dimensions and room ingestion regression tests (CPU only)."""
import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).resolve().parents[1] / 'tools/blender/archisketch_metrics.py'
SPEC = importlib.util.spec_from_file_location('archisketch_metrics', PATH)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)

class ArchisketchMetricTests(unittest.TestCase):
    def test_real_window_does_not_shrink_to_nearby_corners(self):
        out = m.opening_width({'width': 1995}, {'width': 1995}, 1.023)
        self.assertEqual(out['width_m'], 1.995)
        self.assertTrue(out['source_span_conflict'])
        self.assertAlmostEqual(out['source_span_delta_m'], -.972)

    def test_actual_placed_scale_beats_catalog_and_polygon_span(self):
        out = m.opening_width({'width': 1995}, {'width': 1600}, 2.1)
        self.assertEqual(out['width_m'], 1.6)
        self.assertEqual(out['dimension_basis'], 'scaled_editor_item_width')

    def test_real_door_does_not_expand_to_wall_span(self):
        self.assertEqual(m.opening_width({'width': 900}, {'width': 900}, 1.047)['width_m'], .9)

    def test_missing_instance_is_explicitly_provisional(self):
        result = m.opening_width({'width': 900}, endpoint_span_m=1.047)
        self.assertEqual(result['width_m'], .9)
        self.assertEqual(result['dimension_basis'], 'catalog_width_provisional')
        self.assertFalse(result['independent_as_built_validation'])

    def test_bad_instance_must_not_silently_use_catalog(self):
        for value in (None, 0, -1, True, '900', float('nan'), float('inf')):
            with self.subTest(value=value), self.assertRaises(ValueError):
                m.opening_width({'width': 900}, {'width': value}, 1)

    def test_duplicate_semantic_room_is_rejected(self):
        with self.assertRaises(ValueError):
            m.require_unique_room_ids([{'id': 'bathroom-1'}, {'id': 'primary-bath'}, {'id': 'primary-bath'}])

    def test_added_detached_room_is_visible_to_ingestion_gate(self):
        old = [{'archiId': 'original', 'polygon': [[0, 0], [1000, 0], [0, 1000]]}]
        new = old + [{'archiId': 'detached', 'polygon': [[8000, 0], [9000, 0], [8000, 1000]]}]
        change = m.source_room_changes(new, old)
        self.assertEqual(change['added'], ['detached'])
        self.assertEqual(change['unchanged'], ['original'])

    def test_swapped_project_with_same_title_does_not_pass(self):
        old = [{'archiId': 'basic', 'polygon': [[0, 0], [1000, 0], [0, 1000]]}]
        new = [{'archiId': 'expanded', 'polygon': old[0]['polygon']}]
        change = m.source_room_changes(new, old)
        self.assertEqual(change['added'], ['expanded'])
        self.assertEqual(change['removed'], ['basic'])

if __name__ == '__main__':
    unittest.main()
