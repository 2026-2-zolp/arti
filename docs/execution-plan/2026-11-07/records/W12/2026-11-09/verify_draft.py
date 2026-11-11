"""고정된 공개 단가와 운영 결정안의 계산·보류 경계를 읽기 전용으로 확인합니다."""
import copy,json
from decimal import Decimal,ROUND_HALF_UP
from pathlib import Path

ROOT=Path(__file__).resolve().parent
D=Decimal

def validate(book,decision):
    assert book['currency']=='USD' and book['region']==decision['regionCandidate']=='ap-northeast-2'
    assert not decision['deploymentAllowed'] and decision['selectedOption'] is None
    assert decision['monthlyBudgetUsd'] is None and not decision['awsAccessVerified']
    assert decision['pendingDecisions'] and decision['unpricedItems'] and not decision['formalGatePromotion']
    a=decision['assumptions']
    assert a['days']==30 and decision['options']['A']['hostRate']==decision['options']['B']['hostRate']=='t3.medium'
    assert decision['options']['A']['database']=='self_managed' and decision['options']['B']['database']=='rds'
    assert decision['options']['C']['maintainedHours']==720 and decision['options']['C']['runOrStopBilled']
    assert a['modelWorkers']==1 and not a['modelWriterEnabled']
    assert a['s3Role'].startswith('private off-host backup') and not a['freeCreditsIncluded']
    assert a['rdsStorageGiB']>=20 and a['retainedIpv4Hours']==a['days']*24
    assert decision['creditsAvailable'] is False
    assert a['lightsailIpv4Included'] and a['lightsailStoppedBilled']
    assert book['rates']['lightsail-4gb']['unit']=='bundle-month' and book['rates']['lightsail-4gb']['spec']['ipv4Included']
    for name,rate in book['rates'].items():
        assert D(rate['usd'])>=0 and rate['source'] in book['sources']
        if rate['unit']=='Hrs':assert name in {'t3.small','t3.medium','t3.large','rds-t4g-micro','ipv4'}
    rds=book['rates']['rds-t4g-micro']['selectedAttributes']
    assert rds['databaseEngine']=='PostgreSQL' and rds['deploymentOption']=='Single-AZ'
    assert 'InstanceUsage:' in rds['usagetype'] and 'UnusedBox' not in rds['usagetype']
    assert book['rates']['ebs-gp3']['unit']==book['rates']['rds-gp3']['unit']==book['rates']['s3-standard']['unit']=='GB-Mo'

def estimate(book,decision,option,hours):
    a=decision['assumptions'];rate=lambda name:D(book['rates'][name]['usd'])
    # C는 한 달 내내 보유하는 일반 Lightsail VM입니다. stop 시간을 무료로 계산하지 않습니다.
    components=({'bundle':rate('lightsail-4gb'),'s3BackupStorage':rate('s3-standard')*D(a['s3BackupBillingGB'])} if option=='C' else
        {'ec2':rate('t3.medium')*D(hours),'retainedIpv4':rate('ipv4')*D(a['retainedIpv4Hours']),'ebs':rate('ebs-gp3')*D(a['ebsGiB']),'s3BackupStorage':rate('s3-standard')*D(a['s3BackupBillingGB'])})
    if option=='B':components.update(rdsCompute=rate('rds-t4g-micro')*D(hours),rdsStorage=rate('rds-gp3')*D(a['rdsStorageGiB']))
    total=sum(components.values())
    money=lambda x:str(x.quantize(D('.01'),rounding=ROUND_HALF_UP))
    return {'componentsUsd':{k:money(v) for k,v in components.items()},'coreSubtotalExactUsd':str(total),'coreSubtotalUsd':money(total),'withOptionalHostedZoneUsd':money(total+rate('route53-zone')),'isTotalBillOrHardCap':False}

if __name__=='__main__':
    book=json.loads((ROOT/'pricebook.json').read_text(encoding='utf-8'))
    decision=json.loads((ROOT/'decision.json').read_text(encoding='utf-8'))
    validate(book,decision)
    cases=[]
    for name,mutate in [
        ('unauthorized-deployment',lambda b,d:d.update(deploymentAllowed=True)),
        ('unconfirmed-selection',lambda b,d:d.update(selectedOption='B')),
        ('missing-cost-exclusions',lambda b,d:d.update(unpricedItems=[])),
        ('false-free-credit',lambda b,d:d['assumptions'].update(freeCreditsIncluded=True)),
        ('undersized-rds-storage',lambda b,d:d['assumptions'].update(rdsStorageGiB=5)),
        ('idle-ip-unbilled',lambda b,d:d['assumptions'].update(retainedIpv4Hours=176)),
        ('unused-reservation-rate',lambda b,d:b['rates']['rds-t4g-micro']['selectedAttributes'].update(usagetype='APN2-UnusedBox:db.t4g.micro')),
        ('lightsail-ip-double-count',lambda b,d:d['assumptions'].update(lightsailIpv4Included=False)),
        ('lightsail-stop-free',lambda b,d:d['assumptions'].update(lightsailStoppedBilled=False)),
    ]:
        b,d=copy.deepcopy(book),copy.deepcopy(decision);mutate(b,d)
        try:validate(b,d)
        except AssertionError:cases.append({'case':name,'rejected':True})
        else:raise AssertionError('Unsafe draft accepted: '+name)
    costs={option:{str(h):estimate(book,decision,option,h) for h in [720,176]} for option in ['A','B','C']}
    assert D(costs['B']['720']['coreSubtotalExactUsd'])-D(costs['A']['720']['coreSubtotalExactUsd'])==D('20.62')
    assert costs['A']['720']['componentsUsd']['retainedIpv4']==costs['A']['176']['componentsUsd']['retainedIpv4']
    # 중단 뒤에도 저장소·유지 IP 비용은 남습니다. RDS0시간 운영이 가능하다는 견적에는 쓰지 않습니다.
    assert D(estimate(book,decision,'A',0)['coreSubtotalExactUsd'])>0
    assert costs['C']['720']==costs['C']['176'] and 'retainedIpv4' not in costs['C']['720']['componentsUsd']
    print(json.dumps({'ok':True,'negativeCases':cases,'costs':costs,'scope':'draft arithmetic/safety checks, not AWS deployment/quote/approval'},ensure_ascii=False,indent=2))
