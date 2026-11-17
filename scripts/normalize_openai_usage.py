"""Prepare exported OpenAI Usage and Costs JSON for compare_model_costs.py offline."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path


FIELDS = {'input_tokens': 'inputTokens', 'output_tokens': 'outputTokens',
          'input_cached_tokens': 'cachedInputTokens'}


def buckets(payload):
    if payload.get('has_more') is not False or payload.get('next_page'):
        raise ValueError('Collect all pages before normalizing')
    data = sorted(payload['data'], key=lambda row: row['start_time'])
    if not data:
        raise ValueError('Export contains no time buckets')
    end = data[0]['start_time']
    start = end
    for row in data:
        if (type(row['start_time']) is not int or type(row['end_time']) is not int
                or row['start_time'] != end or row['end_time'] <= end):
            raise ValueError('Time buckets must be contiguous without overlaps')
        end = row['end_time']
    return (start, end), [result for row in data for result in row['results']]


def normalize(project, usage, costs=None):
    if not project:
        raise ValueError('Supply the OpenAI project ID')
    window, usage_rows = buckets(usage)
    groups = defaultdict(list)
    for row in usage_rows:
        if row.get('project_id') != project or not row.get('model') or not isinstance(row['model'], str):
            raise ValueError('Usage must contain only this project and be grouped by project_id and model')
        groups[row['model']].append(row)
    rows = []
    for model, entries in sorted(groups.items()):
        normalized = {'model': model}
        for field, target in FIELDS.items():
            counts = [entry.get(field) for entry in entries]
            if any(count is not None and (type(count) is not int or count < 0) for count in counts):
                raise ValueError(f'Invalid {field}')
            normalized[target] = None if None in counts else sum(counts)
        rows.append(normalized)

    currency, billed = 'USD', None
    if costs is not None:
        cost_window, cost_rows = buckets(costs)
        if window != cost_window:
            raise ValueError('Usage and Costs must cover the same interval')
        amounts = [row['amount'] for row in cost_rows]
        if any(row.get('project_id') != project for row in cost_rows):
            raise ValueError('Costs must contain only this project and be grouped by project_id')
        currencies = {row['currency'].upper() for row in amounts}
        if len(currencies) > 1:
            raise ValueError('Costs contain more than one currency')
        values = [Decimal(str(row['value'])) for row in amounts]
        if any(not value.is_finite() for value in values):
            raise ValueError('Cost values must be finite')
        if values:
            billed = sum(values)
            if billed < 0:
                raise ValueError('Net project cost is negative. Review credits separately.')
            currency = currencies.pop()
    start, end = [datetime.fromtimestamp(boundary, timezone.utc).isoformat() for boundary in window]
    return {'project': project, 'start': start, 'end': end, 'currency': currency,
            'billedCost': None if billed is None else format(billed, 'f'), 'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--usage', required=True, type=Path)
    parser.add_argument('--costs', type=Path)
    args = parser.parse_args()
    try:
        usage = json.loads(args.usage.read_text(encoding='utf-8-sig'))
        costs = json.loads(args.costs.read_text(encoding='utf-8-sig'), parse_float=Decimal) if args.costs else None
        report = normalize(args.project, usage, costs)
    except (OSError, TypeError, ValueError, KeyError, AttributeError, OverflowError, InvalidOperation) as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
