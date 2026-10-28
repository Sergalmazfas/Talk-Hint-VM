"""Offline P.OPS report consumer. No database, providers, clock or scheduling.

Input observations are explicit fixture/read-only exports, not a running watcher.
Neither this calculation nor a green row approves the schemas or activates duty.
"""
from __future__ import annotations

import copy
import math
from datetime import datetime

from operating_rules_review import FORM, STATUSES, report_systems


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo is not None else None
    except ValueError:
        return None


def count(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0)


def ratio(numerator, denominator):
    """Unknown is not zero, and a zero denominator has no percentage."""
    reason = None
    if not count(numerator) or not count(denominator):
        reason = "unknown numerator or denominator"
    elif denominator == 0:
        reason = "zero denominator"
    elif numerator > denominator:
        reason = "numerator exceeds denominator"
    return {"numerator": numerator if count(numerator) else None,
            "denominator": denominator if count(denominator) else None,
            "percent": None if reason else 100 * numerator / denominator,
            "reason": reason}


def observation_status(row, start, end, as_of, freshness):
    # An explicit pause is not an incident or a successful observation.
    pause = row.get("pause") or {}
    p_start, p_end = timestamp(pause.get("start")), timestamp(pause.get("end"))
    if pause.get("intentional") is True and pause.get("evidence") and p_start and p_end:
        if p_start <= start and p_end >= end:
            return "выключено", "intentional pause", False
    if row.get("sourceConnected") is not True or not row.get("source"):
        return "нет данных", "missing source", None
    observed = timestamp(row.get("observedAt"))
    if observed is None or not row.get("evidenceUrl"):
        return "не проверено", "missing observation or evidence", None
    if not start <= observed < end or observed > as_of:
        return "не проверено", "observation outside period or in future", None
    if freshness is None:
        return "не проверено", "freshness threshold not supplied", None
    if (as_of - observed).total_seconds() > freshness:
        return "не проверено", "stale observation", None
    status = row.get("status")
    if status not in ("работало", "сбой", "задержка"):
        return "не проверено", "no confirmed operational status", None
    return status, None, status in ("сбой", "задержка")


def delivery_status(delivery):
    # SENT confirms transport only, never reading or acceptance.
    return {
        "sent": True if (delivery.get("sentConfirmed") is True
                         and delivery.get("providerId") and delivery.get("savedVersion")) else None,
        "ownerRead": delivery.get("ownerRead") if isinstance(delivery.get("ownerRead"), bool) else None,
        "acceptedBy": delivery.get("acceptedBy") or None,
    }


def validated_coverage(packet, form):
    """Never shrink the candidate's denominator to whatever rows survived."""
    domains = packet.get("documentationInputs")
    if not isinstance(domains, list) or len(domains) != 10:
        raise ValueError("Work package must identify all ten documentation suppliers")
    domain_ids = [r.get("supplierActionId") for r in domains if isinstance(r, dict)]
    if (len(domain_ids) != 10 or any(not isinstance(id, str) or not id for id in domain_ids)
            or len(set(domain_ids)) != 10):
        raise ValueError("Invalid or duplicate documentation supplier identity")
    if form["version"] == 1:
        return {"domains": [
            {"supplierActionId": r["supplierActionId"], "supplierRoleId": r.get("supplier")}
            for r in domains
        ], "systems": []}
    coverage = form.get("coverageMap")
    if (not isinstance(coverage, dict) or coverage.get("statusVocabulary") != STATUSES
            or coverage.get("scopeActionId") != "oncall-action-scope"
            or not coverage.get("ownerRoleId")):
        raise ValueError("Missing or malformed canonical coverage map")
    actual_domains, actual_systems = coverage.get("domains"), coverage.get("systems")
    if not isinstance(actual_domains, list) or len(actual_domains) != len(domains):
        raise ValueError("Incomplete canonical domain coverage")
    by_id = {}
    for row in actual_domains:
        if not isinstance(row, dict):
            raise ValueError("Malformed domain coverage row")
        id = row.get("supplierActionId")
        if not isinstance(id, str) or id in by_id:
            raise ValueError("Missing or duplicate domain identity")
        by_id[id] = row
    for supplier in domains:
        row = by_id.get(supplier["supplierActionId"], {})
        if (row.get("supplierRoleId") != supplier.get("supplier")
                or not row.get("supplierRoleId")
                or row.get("destinationActionId") != supplier.get("destinationActionId")
                or not isinstance(row.get("resultIds"), list)
                or any(not isinstance(id, str) or not id for id in row["resultIds"])):
            raise ValueError("Domain does not match canonical work-package supplier")
    canonical_systems = report_systems()
    if not isinstance(actual_systems, list) or len(actual_systems) != len(canonical_systems):
        raise ValueError("Incomplete canonical system coverage")
    # Observations are supplied separately: the template must remain the proposal,
    # not an edited subset or runtime copy with silently replaced ownership.
    if (any(not isinstance(row, dict) or not isinstance(row.get("system"), str)
            for row in actual_systems)
            or sorted(actual_systems, key=lambda r: r["system"])
            != sorted(canonical_systems, key=lambda r: r["system"])):
        raise ValueError("System coverage differs from canonical proposal")
    return coverage


def aggregate_results(rows, environment, start, end):
    """Deduplicate underlying results, never add daily percentages or summaries."""
    unique, issues = {}, []
    for row in rows:
        if not isinstance(row, dict):
            issues.append({"reason": "invalid result"})
            continue
        key = tuple(row.get(k) for k in ("resultId", "version", "environment"))
        at = timestamp(row.get("observedAt"))
        if (not isinstance(key[0], str) or not key[0]
                or not isinstance(key[1], (str, int)) or isinstance(key[1], bool)
                or key[1] == "" or not isinstance(key[2], str) or not key[2]):
            issues.append({"reason": "missing result identity", "supplier": row.get("supplier")})
            continue
        if row["environment"] != environment or at is None or not start <= at < end:
            issues.append({"reason": "result outside environment/period", "resultId": key[0]})
            continue
        # Report wrappers and precomputed percentages cannot affect result identity.
        payload = {k: row.get(k) for k in
                   ("expected", "actual", "acceptance", "evidenceUrl", "supplier")}
        if key in unique and unique[key] != payload:
            unique[key] = {"conflict": True, "supplier": row.get("supplier")}
        else:
            unique[key] = payload
    known_plan = known_fact = accepted = returned = pending = 0
    unknown_plan = unknown_fact = 0
    for key, row in unique.items():
        trusted = bool(row.get("evidenceUrl")) and not row.get("conflict")
        for field in ("expected", "actual"):
            if not trusted or not count(row.get(field)):
                if field == "expected":
                    unknown_plan += 1
                else:
                    unknown_fact += 1
            elif field == "expected":
                known_plan += row[field]
            else:
                known_fact += row[field]
        if row.get("conflict"):
            issues.append({"reason": "conflicting duplicate", "resultId": key[0]})
        if trusted and row.get("acceptance") == "accepted":
            accepted += 1
        elif trusted and row.get("acceptance") == "returned":
            returned += 1
        else:
            pending += 1
    incomplete = bool(issues) or not unique
    plan = None if incomplete or unknown_plan else known_plan
    fact = None if incomplete or unknown_fact else known_fact
    return {
        "uniqueResultIds": [dict(zip(("resultId", "version", "environment"), k)) for k in unique],
        "plan": plan, "fact": fact, "planFact": ratio(fact, plan),
        "knownPlanSubtotal": known_plan, "knownFactSubtotal": known_fact,
        "accepted": accepted if unique and not issues else None,
        "returned": returned if unique and not issues else None,
        "pendingAcceptance": pending if unique and not issues else None,
        "knownAcceptedSubtotal": accepted, "knownReturnedSubtotal": returned,
        "knownPendingAcceptanceSubtotal": pending,
        "unknownPlanRows": unknown_plan, "unknownFactRows": unknown_fact,
        "issues": issues,
    }


def generate_report(packet, form, inputs):
    """Consume the existing v1 or proposed v2 form without changing either.

    inputs: explicit periodStart/End, timezone, environment, asOf,
    freshnessSeconds (caller policy, no invented SLA), observations, results,
    dailyReports (raw result rows only), delivery.
    """
    if form.get("format") != "talkhint.ops.daily-report":
        raise ValueError("Unsupported report form")
    version = form.get("version")
    if (packet.get("version"), version) not in ((2, 1), (3, 2)):
        raise ValueError("Unsupported work-package/form versions")
    ref = packet.get("dailyReportForm", {})
    if version == 1 and ref != form:
        raise ValueError("Embedded canonical form mismatch")
    if version == 2 and (ref.get("documentId") != FORM or ref.get("version") != version):
        raise ValueError("Canonical form reference mismatch")
    start, end, as_of = (timestamp(inputs.get(k)) for k in ("periodStart", "periodEnd", "asOf"))
    if not start or not end or not as_of or start >= end or as_of < end:
        raise ValueError("Explicit closed period and timezone-aware asOf required")
    environment = inputs.get("environment")
    if not environment or not inputs.get("timezone"):
        raise ValueError("Explicit environment and timezone required")
    freshness = inputs.get("freshnessSeconds")
    if freshness is not None and (not count(freshness) or freshness == 0):
        raise ValueError("Invalid freshness policy")
    period = inputs.get("period", "day")
    if period not in ("day", "week", "month"):
        raise ValueError("Unknown period")
    if period != "day" and period not in form.get("periodicReports", {}):
        raise ValueError("Periodic schema unavailable")

    coverage = validated_coverage(packet, form)
    expected = [
        {"key": "domain:" + r["supplierActionId"], "supplier": r.get("supplierRoleId", r.get("supplier"))}
        for r in coverage["domains"]
    ] + [
        {"key": "system:" + r["system"], "supplier": r.get("supplierRoleId")}
        for r in coverage["systems"]
    ]
    observations = inputs.get("observations", [])
    details = []
    for entry in expected:
        matches = [r for r in observations if r.get("key") == entry["key"]
                   and r.get("environment") == environment]
        # Ambiguous input is not resolved by silently picking a successful row.
        row = matches[0] if len(matches) == 1 else {}
        status, reason, incident = observation_status(row, start, end, as_of, freshness)
        if len(matches) > 1:
            status, reason, incident = "не проверено", "ambiguous observations", None
        details.append({**copy.deepcopy(row), **entry, "status": status,
                        "reason": reason, "incident": incident})
    extra_keys = sorted({r.get("key", "") for r in observations} - {e["key"] for e in expected})
    raw_results = list(inputs.get("results", []))
    aggregation_issues = []
    for daily in inputs.get("dailyReports", []):
        # Summaries with percentages cannot be reconstructed into counts.
        if not isinstance(daily.get("results"), list):
            aggregation_issues.append({"reason": "daily report has no underlying results",
                                       "source": daily.get("id")})
        else:
            raw_results.extend(daily["results"])
    results = aggregate_results(raw_results, environment, start, end)
    results["issues"].extend(aggregation_issues)
    unknown = sum(r["incident"] is None for r in details)
    if unknown:
        results["issues"].append({"reason": "incomplete source coverage; totals may be partial"})
    if aggregation_issues or unknown:
        results.update(plan=None, fact=None, accepted=None, returned=None, pendingAcceptance=None,
                       planFact=ratio(None, None))
    return {
        "format": "talkhint.ops.offline-report", "formVersion": version,
        "schemaStatus": form.get("status"), "execution": "offline-only; no duty activation or acceptance",
        "header": {k: inputs.get(k) for k in
                   ("periodStart", "periodEnd", "timezone", "environment", "asOf")},
        "period": period, "detailRows": details,
        "unmappedObservationKeys": extra_keys,
        "systemSummary": ("сбой" if any(r["incident"] for r in details) else
                          "нет данных" if unknown or not details else
                          "выключено" if any(r["status"] == "выключено" for r in details) else "работало"),
        "unknownCoverageRows": unknown,
        "coverage": ratio(sum(r["status"] in ("работало", "сбой", "задержка") for r in details),
                          len(details) if details else None),
        "results": results,
        "delivery": delivery_status(inputs.get("delivery", {})),
    }


if __name__ == "__main__":
    import argparse
    import json
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True,
                        help="Local JSON envelope with packet, form and inputs")
    args = parser.parse_args()
    try:
        envelope = json.loads(args.input.read_text())
        output = generate_report(envelope["packet"], envelope["form"], envelope["inputs"])
        print(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"P.OPS offline report refused: {error}", file=sys.stderr)
        sys.exit(1)
