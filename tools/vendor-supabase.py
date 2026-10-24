"""Reproduce the pinned browser SDK from the official npm package; no npm scripts run."""
import base64,hashlib,io,json,tarfile,urllib.request
from pathlib import Path
VERSION='2.118.0'
ROOT=Path(__file__).resolve().parents[1]
REGISTRY=f'https://registry.npmjs.org/@supabase/supabase-js/{VERSION}'
with urllib.request.urlopen(REGISTRY,timeout=30) as response:
    metadata=json.load(response)
url=metadata['dist']['tarball']
assert url==f'https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-{VERSION}.tgz'
with urllib.request.urlopen(url,timeout=60) as response:
    data=response.read()
integrity='sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
assert integrity==metadata['dist']['integrity'],'Package integrity mismatch'
target=ROOT/'dist'/'vendor';target.mkdir(parents=True,exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
    for source,name in [('package/dist/umd/supabase.js',f'supabase-{VERSION}.js'),('package/LICENSE','supabase-LICENSE.txt')]:
        member=archive.getmember(source)
        assert member.isfile()
        (target/name).write_bytes(archive.extractfile(member).read())
bundle=target/f'supabase-{VERSION}.js'
(target/'supabase-lock.json').write_text(json.dumps({'package':'@supabase/supabase-js','version':VERSION,'registry':REGISTRY,'tarball':url,'integrity':integrity,'bundle_sha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'license':'MIT'},indent=2)+'\n',encoding='utf-8')
print(f'Verified and vendored @supabase/supabase-js {VERSION}: {bundle.stat().st_size} bytes')
