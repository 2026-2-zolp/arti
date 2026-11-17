"""Reconcile normalized text-token counts and a project bill without network calls."""
import argparse
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


TOKEN_FIELDS = ('inputTokens', 'outputTokens', 'cachedInputTokens')


def window(source):
    parsed = tuple(datetime.fromisoformat(source[key]) for key in ('start', 'end'))
    if any(value.utcoffset() is None for value in parsed) or parsed[0] >= parsed[1]:
        raise ValueError('Both window boundaries need offsets and start must precede end')
    return tuple(value.astimezone(timezone.utc) for value in parsed)


def tokens(row):
    values = tuple(row.get(key) for key in TOKEN_FIELDS)
    if any(value is not None and (type(value) is not int or value < 0) for value in values):
        raise ValueError('Token counts must be nonnegative integers or null')
    if values[0] is not None and values[2] is not None and values[2] > values[0]:
        raise ValueError('Cached input exceeds input tokens')
    return values


def amount(raw):
    if not isinstance(raw, (str, int)) or isinstance(raw, bool):
        raise ValueError('Amounts must be decimal strings or integers')
    value = Decimal(raw)
    if not value.is_finite() or value < 0:
        raise ValueError('Amounts must be finite and nonnegative')
    return value


def compare(application, provider):
    if (not application['project'] or application['project'] != provider['project']
            or window(application) != window(provider)):
        raise ValueError('Use the same project and time window for both inputs')
    currency = provider['currency']
    if not isinstance(currency, str) or len(currency) != 3 or not currency.isascii() or not currency.isalpha():
        raise ValueError('Specify the bill currency as a three-letter code')
    ungrouped = application.get('ungroupedAttempts', 0)
    if type(ungrouped) is not int or ungrouped < 0:
        raise ValueError('Ungrouped attempts must be a nonnegative integer')

    app_groups = {}
    seen = set()
    for row in application['rows']:
        key = (row['task'], row['model'])
        if any(not isinstance(value, str) for value in key) or any(
                type(row.get(field)) is not int or row[field] < 0 for field in ('missing', 'cacheMissing')):
            raise ValueError('Application rows need text identifiers and nonnegative missing counts')
        if key in seen:
            raise ValueError('Duplicate application task/model row')
        seen.add(key)
        app_groups.setdefault(row['model'], []).append(row)
    provider_groups = {}
    for row in provider['rows']:
        model = row['model']
        if not isinstance(model, str) or not model:
            raise ValueError('Provider rows need a model identifier')
        if model in provider_groups:
            raise ValueError('Duplicate provider model row')
        provider_groups[model] = row

    report = []
    estimates = []
    for model in sorted(app_groups.keys() | provider_groups.keys()):
        app_rows = app_groups.get(model, [])
        billed_row = provider_groups.get(model, {})
        app_values = [tokens(row) for row in app_rows]
        vendor_values = tokens(billed_row)
        columns = tuple(zip(*app_values)) if app_values else ((), (), ())
        totals = tuple(sum(values) if values and None not in values else None for values in columns)
        complete_app = bool(model and app_rows and None not in totals
                            and all(row.get('missing') == row.get('cacheMissing') == 0 for row in app_rows))
        comparison = ('incomplete' if not complete_app or None in vendor_values else
                      'matched' if totals == vendor_values else 'different')
        rate = billed_row.get('ratesPerMillion')
        estimate = None
        if complete_app and rate:
            total_input, output, cached = totals
            estimate = ((total_input - cached) * amount(rate['input']) + cached * amount(rate['cachedInput'])
                        + output * amount(rate['output'])) / 1_000_000
        if comparison == 'matched' and estimate is not None:
            estimates.append(estimate)
        report.append({'model': model, 'status': comparison, 'application': dict(zip(TOKEN_FIELDS, totals)),
                       'provider': dict(zip(TOKEN_FIELDS, vendor_values)),
                       'estimatedCost': format(estimate, 'f') if estimate is not None else None})
    billed = amount(provider['billedCost']) if provider.get('billedCost') is not None else None
    project_estimate = sum(estimates, Decimal(0)) if not ungrouped and report and len(estimates) == len(report) else None
    return {'project': provider['project'], 'currency': currency.upper(), 'models': report,
            'ungroupedAttempts': ungrouped,
            'billedCost': format(billed, 'f') if billed is not None else None,
            'comparableEstimatedCost': format(project_estimate, 'f') if project_estimate is not None else None,
            'estimateMinusBill': format(project_estimate - billed, 'f') if project_estimate is not None and billed is not None else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('application', type=Path)
    parser.add_argument('provider', type=Path)
    args = parser.parse_args()
    try:
        application, provider = (json.loads(path.read_text(encoding='utf-8-sig')) for path in (args.application, args.provider))
        report = compare(application, provider)
    except (OSError, ValueError, TypeError, KeyError, InvalidOperation) as error:
        parser.error(str(error))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
