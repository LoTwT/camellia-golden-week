from pathlib import Path
import hashlib, json, zipfile, urllib.request, subprocess
root=Path(__file__).resolve().parents[4]
out=root/'docs/verification/evidence/firewall-hazards'
out.mkdir(parents=True, exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
def inventory(directory):
    return {str(p.relative_to(directory)):{'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(directory.rglob('*')) if p.is_file()}
files=inventory(root/'dist')
validated=inventory(root/'test-results/review-fixes/pipeline/builds/production')
assert files==validated, 'dist must equal Chrome-validated production'
archive=out/'firewall-hazards-dist.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in files:
        item=zipfile.ZipInfo(name, date_time=(2026,9,12,0,0,0))
        item.compress_type=zipfile.ZIP_DEFLATED
        item.external_attr=0o100644<<16
        z.writestr(item,(root/'dist'/name).read_bytes())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert set(z.namelist())==set(files)
    for name, entry in files.items():
        assert sha(z.read(name))==entry['sha256']
readback=urllib.request.build_opener(urllib.request.ProxyHandler({}))
responses=[]
for name in ['',*files]:
    url='http://localhost:5174/'+name
    with readback.open(url,timeout=10) as response:
        data=response.read()
        target='index.html' if not name else name
        assert response.status==200 and sha(data)==files[target]['sha256'],url
        responses.append({'path':'/'+name,'status':response.status,'contentType':response.headers.get('Content-Type'),'bytes':len(data),'sha256':sha(data)})
summary={'version':'0.5.0','profile':'M5','contentVersion':5,'ruleVersion':3,'schemaVersion':2,'files':files,'fileCount':len(files),'totalBytes':sum(f['bytes'] for f in files.values()),'zip':{'path':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive.read_bytes()),'crcPassed':True},'matchesChromeValidatedBuild':True,'httpResponses':len(responses)}
(out/'package.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
(out/'http-audit.json').write_text(json.dumps({'baseUrl':'http://localhost:5174','proxy':'process-local loopback direct','responses':responses},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='files'},ensure_ascii=False))
