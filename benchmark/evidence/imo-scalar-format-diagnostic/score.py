"""Join a locked scalar prediction file to the six diagnostic human scores. Never read the confirmation labels."""
import argparse,hashlib,json,re
from pathlib import Path
from statistics import mean

BASE=Path(__file__).resolve().parent
sha=lambda d:hashlib.sha256(d).hexdigest()
def fingerprinted(path,expected):
    blob=path.read_bytes()
    if sha(blob)!=expected:raise ValueError('Unexpected fingerprint: '+path.name)
    return json.loads(blob)

def clean_code(code):
    if code is not None and (not isinstance(code,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',code)):raise ValueError('Illegal transport code')
    return code

def pack(record):
    if 'suggestedScore' not in record:raise ValueError('A missing proposal must be explicit null')
    readings=record.get('readings',[])
    if not isinstance(readings,list) or len(readings)>2:raise ValueError('Unexpected reading list')
    points=[];codes=[]
    for r in readings:
        s=r['score']
        if s is not None and (type(s) is not int or not 0<=s<=7):raise ValueError('Invalid reading score')
        points.append(s);codes.append(clean_code(r.get('code')))
    points.extend([None]*(2-len(points)));codes.extend([None]*(2-len(codes)))
    agreed=points[0] if points[0] is not None and points[0]==points[1] else None
    if record['suggestedScore']!=agreed or (record['suggestedScore'] is not None and type(record['suggestedScore']) is not int):raise ValueError('Returned score disagrees with strict consensus policy')
    http=record.get('http',record.get('httpStatus',record.get('transport',{}).get('httpStatus')))
    if http is not None and (type(http)is not int or not 100<=http<=599):raise ValueError('Invalid recorded HTTP status')
    if 'returnedNativeReceipts' in record:
        receipt_count=record['returnedNativeReceipts']
        if type(receipt_count)is not int or not 0<=receipt_count<=2:raise ValueError('Invalid published receipt count')
    else:
        receipts=record.get('receipts',[])
        if not isinstance(receipts,list) or len(receipts)>2:raise ValueError('Unexpected number of binding receipts')
        receipt_count=len(receipts)
    return {'id':record['id'],'reading1':points[0],'reading2':points[1],'strictConsensus':agreed,'httpStatus':http,
            'returnedNativeReceipts':receipt_count,'readingErrorCodes':codes,'outcome':clean_code(record.get('reason',record.get('reviewReason')))}

def measure(rows,field):
    n=len(rows);errors=[r[field]-r['humanScore'] for r in rows if r[field] is not None];k=len(errors)
    exact=sum(v==0 for v in errors);within=sum(abs(v)<=1 for v in errors)
    return {'registered':n,'validScores':k,'abstentions':n-k,'coverage':k/n if n else None,'exactCount':exact,'withinOneCount':within,
            'exactPerRegistered':exact/n if n else None,'withinOnePerRegistered':within/n if n else None,
            'exactAmongValid':exact/k if k else None,'withinOneAmongValid':within/k if k else None,
            'maeAmongValid':mean(map(abs,errors))if k else None,'signedBiasAmongValid':mean(errors)if k else None,
            'overCount':sum(e>0 for e in errors),'underCount':sum(e<0 for e in errors)}

def compare(ids,gold,pred):
    if not ids or len(set(ids))!=len(ids):raise ValueError('Invalid registered cohort')
    byid={r['id']:r for r in gold};predby={r['id']:r for r in pred}
    if len(predby)!=len(pred) or len(byid)!=len(gold) or set(byid)!=set(ids) or set(predby)!=set(ids):raise ValueError('Every original ID requires an explicit record')
    rows=[]
    for i in ids:
        g=byid[i];v=g['score']
        if type(v)is not int or not 1<=v<=6 or g['source']!='human' or g['maxMarks']!=7:raise ValueError('Invalid partial-score diagnostic label')
        rows.append({**pack(predby[i]),'humanScore':v})
    reached=[r for r in rows if r['httpStatus']==200 and r['returnedNativeReceipts']==2]
    both=[r for r in rows if r['reading1'] is not None and r['reading2'] is not None]
    stats=lambda subset:{k:measure(subset,k)for k in ('reading1','reading2','strictConsensus')}
    return {'scope':'Number-only response format on a separately frozen partial-only research cohort; no deployment or release gate. No pooling with prior studies.',
            'registered':len(rows),'http200WithTwoReceipts':len(reached),'bothReadingsValid':len(both),'validReadingsDisagreed':sum(r['reading1']!=r['reading2']for r in both),
            'allRegistered':stats(rows),'onlyReached':stats(reached),'cases':rows}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--predictions',type=Path,required=True);p.add_argument('--expected-hash',required=True)
    p.add_argument('--data-dir',type=Path,default=BASE);p.add_argument('--wire',choices=['json','plain'],required=True);p.add_argument('--out',type=Path,required=True);args=p.parse_args()
    lock=json.loads((args.data_dir/'manifest.json').read_text());fixture=fingerprinted(args.data_dir/'blind/fixtures.json',lock['fixtureSha256']);ids=[r['id']for r in fixture]
    pred=fingerprinted(args.predictions,args.expected_hash)
    if len(pred)!=len(ids) or {r['id']for r in pred}!=set(ids):raise ValueError('Incomplete or repeated prediction records')
    for row in pred:pack(row)
    gold=fingerprinted(args.data_dir/'custodian/sealed-targets.json',lock['sealedTargetsSha256'])
    result=compare(ids,gold,pred);result['wire']=args.wire;result['fixtureSha256']=lock['fixtureSha256'];result['predictionSha256']=args.expected_hash;result['targetSha256']=lock['sealedTargetsSha256']
    data=(json.dumps(result,indent=2)+'\n').encode()
    if args.out.exists() and args.out.read_bytes()!=data:raise ValueError('Conflicting result path')
    args.out.write_bytes(data);print(f'Compared {len(ids)} locked case predictions.')
