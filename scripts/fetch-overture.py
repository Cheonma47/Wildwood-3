# Downloads Overture Maps "places" (CDLA-Permissive-2.0 / ODbL sources) for the
# Wildwood study area into data/overture/places.json. Requires: pip install duckdb
# Uses anonymous HTTPS range reads, so only the matching row groups are fetched.
import json, os, re, urllib.request, duckdb

RELEASE = os.environ.get('OVERTURE_RELEASE', '2026-09-23.0')
B = dict(west=-74.84, east=-74.79, south=38.965, north=39.005)
base = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com'
listing = urllib.request.urlopen(f'{base}/?list-type=2&prefix=release/{RELEASE}/theme=places/type=place/').read().decode()
urls = [f'{base}/{k}' for k in re.findall(r'<Key>([^<]+)</Key>', listing)]
con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
rows = con.execute(f"""
SELECT names."primary", basic_category, taxonomy."primary", addresses[1].freeform, confidence, operating_status,
       (bbox.xmin+bbox.xmax)/2, (bbox.ymin+bbox.ymax)/2
FROM read_parquet({urls!r})
WHERE bbox.xmin > {B['west']} AND bbox.xmax < {B['east']} AND bbox.ymin > {B['south']} AND bbox.ymax < {B['north']}
""").fetchall()
os.makedirs('data/overture', exist_ok=True)
json.dump([dict(name=r[0], basic=r[1], cat=r[2], addr=r[3], conf=r[4], status=r[5], lon=r[6], lat=r[7]) for r in rows],
          open('data/overture/places.json', 'w'))
print(len(rows), 'places')
