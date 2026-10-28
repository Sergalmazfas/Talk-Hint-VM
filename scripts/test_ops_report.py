"""Consumer fixtures supplied by oncallRole.test.ts from the real document builder.

Run: npx vitest run server/projectModel/oncallRole.test.ts
No live snapshot, services, credentials or owner acceptance are needed.
"""
import copy
import json
import sys
import unittest

from operating_rules_review import apply_patch, report_form_patch, report_packet_patch
from ops_report import generate_report, ratio


def run_contract_tests(contract):
    packet, base_form, data = (contract[k] for k in ("packet", "form", "data"))
    proposed_form = apply_patch(base_form, report_form_patch(packet, data))
    proposed_packet = apply_patch(packet, report_packet_patch(packet, 822, "https://fixture.invalid"))

    class ConsumerFixtures(unittest.TestCase):
        def setUp(self):
            self.packet = copy.deepcopy(proposed_packet)
            self.form = copy.deepcopy(proposed_form)
            self.inputs = {
                "periodStart": "2026-10-27T00:00:00Z", "periodEnd": "2026-10-28T00:00:00Z",
                "asOf": "2026-10-28T00:00:00Z", "timezone": "UTC", "environment": "fixture",
                "freshnessSeconds": 3600, "observations": [], "results": [],
            }
            keys = ["domain:" + r["supplierActionId"] for r in self.form["coverageMap"]["domains"]]
            keys += ["system:" + r["system"] for r in self.form["coverageMap"]["systems"]]
            for key in keys:
                self.inputs["observations"].append({
                    "key": key, "environment": "fixture", "sourceConnected": True,
                    "source": "fixture://events", "observedAt": "2026-10-27T23:30:00Z",
                    "evidenceUrl": "fixture://observation", "status": "работало",
                })

        def report(self):
            return generate_report(self.packet, self.form, self.inputs)

        def result(self, id="a", **changes):
            return {
                "resultId": id, "version": 1, "environment": "fixture",
                "observedAt": "2026-10-27T23:30:00Z", "supplier": "fixture-role",
                "evidenceUrl": "fixture://result", "expected": 1, "actual": 1,
                "acceptance": None, **changes,
            }

        def test_baseline_consumes_real_v1_and_preserves_every_input(self):
            before = copy.deepcopy((packet, base_form, self.inputs))
            report = generate_report(packet, base_form, self.inputs)
            self.assertEqual(len(report["detailRows"]), len(packet["documentationInputs"]))
            self.assertEqual((packet, base_form, self.inputs), before)
            self.assertIsNone(report["results"]["fact"])

        def test_candidate_is_the_same_patch_used_by_review_generator(self):
            self.assertEqual(self.form["version"], 2)
            self.assertEqual(len(self.report()["detailRows"]), 20)
            self.assertEqual(self.report()["schemaStatus"], "Кандидат доработки P.OPS, не утверждено")
            self.assertIsNone(self.packet["manualPass"]["verdict"])
            self.assertFalse(self.packet["authorization"]["dailyScheduleEnabled"])

        def test_missing_input_does_not_hide_other_nineteen(self):
            self.inputs["observations"].pop(0)
            self.inputs["results"] = [self.result()]
            report = self.report()
            self.assertEqual(report["systemSummary"], "нет данных")
            self.assertEqual(len(report["detailRows"]), 20)
            self.assertEqual(report["detailRows"][0]["status"], "нет данных")
            self.assertTrue(report["detailRows"][0]["supplier"])
            self.assertEqual(report["detailRows"][1]["status"], "работало")
            self.assertIsNone(report["detailRows"][0]["incident"])
            self.assertIsNone(report["results"]["planFact"]["percent"])
            self.assertIsNone(report["results"]["fact"])
            self.assertEqual(report["results"]["knownFactSubtotal"], 1)

        def test_source_code_is_not_runtime_evidence(self):
            self.inputs["observations"] = []
            report = self.report()
            self.assertEqual(report["unknownCoverageRows"], 20)
            self.assertNotEqual(report["systemSummary"], "работало")
            self.assertIsNone(report["results"]["plan"])

        def test_stale_observation_is_not_success_or_an_invented_incident(self):
            self.inputs["observations"][0]["observedAt"] = "2026-10-27T10:00:00Z"
            row = self.report()["detailRows"][0]
            self.assertEqual(row["status"], "не проверено")
            self.assertEqual(row["reason"], "stale observation")
            self.assertIsNone(row["incident"])
            self.assertNotEqual(self.report()["systemSummary"], "работало")

        def test_no_threshold_no_evidence_future_and_wrong_environment_are_unknown(self):
            for field, value in [
                ("evidenceUrl", None), ("observedAt", "2026-10-28T01:00:00Z"),
                ("observedAt", "2026-10-27T23:30:00"), ("environment", "production"),
                ("sourceConnected", False),
            ]:
                with self.subTest(field=field, value=value):
                    original = copy.deepcopy(self.inputs["observations"][0])
                    self.inputs["observations"][0][field] = value
                    self.assertIsNone(self.report()["detailRows"][0]["incident"])
                    self.inputs["observations"][0] = original
            self.inputs["freshnessSeconds"] = None
            self.assertEqual(self.report()["unknownCoverageRows"], 20)

        def test_intentional_pause_is_not_incident_or_green(self):
            row = self.inputs["observations"][0]
            row.update(sourceConnected=False, pause={
                "intentional": True, "start": self.inputs["periodStart"],
                "end": self.inputs["periodEnd"], "evidence": "fixture://owner-pause",
            })
            report = self.report()
            self.assertEqual(report["detailRows"][0]["status"], "выключено")
            self.assertFalse(report["detailRows"][0]["incident"])
            self.assertEqual(report["systemSummary"], "выключено")
            row["pause"]["evidence"] = None
            self.assertEqual(self.report()["detailRows"][0]["status"], "нет данных")

        def test_failure_is_visible_even_when_another_source_is_missing(self):
            self.inputs["observations"].pop(0)
            self.inputs["observations"][0]["status"] = "сбой"
            report = self.report()
            self.assertEqual(report["systemSummary"], "сбой")
            self.assertEqual(report["unknownCoverageRows"], 1)
            self.assertTrue(report["detailRows"][1]["incident"])

        def test_unknown_denominator_and_numerator_are_not_zero(self):
            for expected, actual in [(None, 1), (1, None), (0, 0), (None, None)]:
                with self.subTest(expected=expected, actual=actual):
                    self.inputs["results"] = [self.result(expected=expected, actual=actual)]
                    result = self.report()["results"]
                    self.assertIsNone(result["planFact"]["percent"])
                    self.assertEqual(result["plan"], expected)
                    self.assertEqual(result["fact"], actual)
                    self.assertIsNotNone(result["planFact"]["reason"])

        def test_unknown_one_result_keeps_other_known_subtotals_visible(self):
            self.inputs["results"] = [self.result(), self.result("b", expected=None, actual=None)]
            result = self.report()["results"]
            self.assertIsNone(result["fact"])
            self.assertEqual(result["knownFactSubtotal"], 1)
            self.assertIsNone(result["planFact"]["percent"])

        def test_percentages_recomputed_from_counts_never_averaged(self):
            self.inputs["results"] = [self.result(), self.result("b", expected=9)]
            self.assertEqual(self.report()["results"]["planFact"]["percent"], 20)
            for bad in (None, -1, True, float("nan"), float("inf"), "1"):
                self.assertIsNone(ratio(bad, 10)["percent"])
            self.assertIsNone(ratio(2, 1)["percent"])

        def test_week_and_month_deduplicate_raw_results_not_daily_percentages(self):
            for period in ("week", "month"):
                with self.subTest(period=period):
                    self.inputs.update(period=period,
                                       periodStart="2026-10-01T00:00:00Z" if period == "month" else "2026-10-26T00:00:00Z",
                                       dailyReports=[
                        {"id": "day1", "percent": 100, "results": [self.result()]},
                        {"id": "day2", "percent": 11.11,
                         "results": [self.result(), self.result("b", expected=9, observedAt="2026-10-26T20:00:00Z")]},
                    ])
                    result = self.report()["results"]
                    self.assertEqual(len(result["uniqueResultIds"]), 2)
                    self.assertEqual((result["plan"], result["fact"]), (10, 2))
                    self.assertEqual(result["planFact"]["percent"], 20)
                    self.assertEqual(result["pendingAcceptance"], 2)

        def test_identity_includes_version_and_environment(self):
            self.inputs["results"] = [self.result(), self.result(version=2)]
            self.assertEqual(len(self.report()["results"]["uniqueResultIds"]), 2)
            self.inputs["results"].append(self.result(environment="production"))
            result = self.report()["results"]
            self.assertEqual(result["knownFactSubtotal"], 2)
            self.assertIsNone(result["fact"])
            self.assertTrue(result["issues"])

        def test_conflicting_duplicate_never_becomes_success(self):
            a = self.result()
            self.inputs["results"] = [a, self.result(actual=0), a]
            result = self.report()["results"]
            self.assertEqual(len(result["uniqueResultIds"]), 1)
            self.assertIsNone(result["fact"])
            self.assertEqual(result["issues"][0]["reason"], "conflicting duplicate")

        def test_summary_only_day_does_not_silently_disappear(self):
            self.inputs["dailyReports"] = [{"id": "missing-raw", "percent": 100}]
            self.inputs["results"] = [self.result()]
            result = self.report()["results"]
            self.assertIsNone(result["fact"])
            self.assertEqual(result["knownFactSubtotal"], 1)
            self.assertTrue(result["issues"])

        def test_sent_without_acceptance_is_transport_only(self):
            self.inputs["delivery"] = {
                "savedVersion": 1, "providerId": "fixture-provider", "sentConfirmed": True,
            }
            self.inputs["results"] = [self.result()]
            report = self.report()
            self.assertTrue(report["delivery"]["sent"])
            self.assertIsNone(report["delivery"]["ownerRead"])
            self.assertIsNone(report["delivery"]["acceptedBy"])
            self.assertEqual(report["results"]["accepted"], 0)
            self.assertEqual(report["results"]["pendingAcceptance"], 1)
            self.inputs["results"][0]["acceptance"] = "accepted"
            self.assertEqual(self.report()["results"]["accepted"], 1)
            self.inputs["delivery"]["providerId"] = None
            self.assertIsNone(self.report()["delivery"]["sent"])

        def test_schema_mismatch_and_unclosed_period_fail_explicitly(self):
            self.packet["dailyReportForm"]["version"] = 9
            with self.assertRaises(ValueError):
                self.report()
            self.packet = copy.deepcopy(proposed_packet)
            self.inputs["asOf"] = self.inputs["periodStart"]
            with self.assertRaises(ValueError):
                self.report()

        def test_candidate_cannot_silently_drop_entire_coverage_map(self):
            del self.form["coverageMap"]
            # This formerly fell back to ten domain inputs and reported green.
            self.inputs["observations"] = self.inputs["observations"][:10]
            with self.assertRaisesRegex(ValueError, "coverage map"):
                self.report()

        def test_candidate_cannot_remove_or_replace_expected_systems(self):
            for mutation in ("missing", "empty", "removed", "duplicate", "renamed", "supplier"):
                with self.subTest(mutation=mutation):
                    self.form = copy.deepcopy(proposed_form)
                    coverage = self.form["coverageMap"]
                    if mutation == "missing":
                        del coverage["systems"]
                    elif mutation == "empty":
                        coverage["systems"] = []
                    elif mutation == "removed":
                        coverage["systems"].pop()
                    elif mutation == "duplicate":
                        coverage["systems"][-1] = copy.deepcopy(coverage["systems"][0])
                    elif mutation == "renamed":
                        coverage["systems"][0]["system"] = "replacement"
                    else:
                        coverage["systems"][0]["supplierRoleId"] = "wrong-role"
                    with self.assertRaises(ValueError):
                        self.report()

        def test_candidate_cannot_remove_or_replace_expected_domains(self):
            for mutation in ("missing", "removed", "duplicate", "supplier", "malformed"):
                with self.subTest(mutation=mutation):
                    self.form = copy.deepcopy(proposed_form)
                    coverage = self.form["coverageMap"]
                    if mutation == "missing":
                        del coverage["domains"]
                    elif mutation == "removed":
                        coverage["domains"].pop()
                    elif mutation == "duplicate":
                        coverage["domains"][-1] = copy.deepcopy(coverage["domains"][0])
                    elif mutation == "supplier":
                        coverage["domains"][0]["supplierRoleId"] = "wrong-role"
                    else:
                        coverage["domains"][0]["resultIds"] = None
                    with self.assertRaises(ValueError):
                        self.report()

        def test_consumer_does_not_mutate_inputs_or_claim_owner_acceptance(self):
            before = copy.deepcopy((self.packet, self.form, self.inputs))
            self.report()
            self.assertEqual((self.packet, self.form, self.inputs), before)

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ConsumerFixtures)
    return unittest.TextTestRunner(verbosity=2).run(suite)


if __name__ == "__main__":
    result = run_contract_tests(json.load(sys.stdin))
    sys.exit(0 if result.wasSuccessful() else 1)
