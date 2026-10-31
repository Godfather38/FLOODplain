"""Download Overture Maps features inside a bounding box, without DuckDB.

Overture publishes OpenStreetMap-derived roads (transportation/segment,
transportation/connector) and waterways (base/water) as GeoParquet on a
public S3 bucket. Files are spatially sorted and carry per-row-group bbox
statistics, so we read each file's footer over HTTP range requests and only
download the row groups that overlap our box.

Usage:
  python3 tools/fetch_overture.py RELEASE THEME TYPE W S E N OUT.parquet
"""
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import fsspec
import pyarrow as pa
import pyarrow.parquet as pq
import requests

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"


def list_keys(prefix):
    keys, token = [], None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if token:
            params["continuation-token"] = token
        xml = requests.get(BUCKET + "/", params=params, timeout=60).text
        keys += re.findall(r"<Key>([^<]+\.parquet)</Key>", xml)
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", xml)
        if not m:
            return keys
        token = m.group(1)


def col_index(schema, dotted):
    for i in range(len(schema)):
        if schema.column(i).path == dotted:
            return i
    raise KeyError(dotted)


def overlapping_row_groups(md, box):
    w, s, e, n = box
    sch = md.schema
    ix = {k: col_index(sch, f"bbox.{k}") for k in ("xmin", "xmax", "ymin", "ymax")}
    hits = []
    for rg in range(md.num_row_groups):
        r = md.row_group(rg)
        st = {k: r.column(i).statistics for k, i in ix.items()}
        if any(v is None or not v.has_min_max for v in st.values()):
            hits.append(rg)
            continue
        if st["xmin"].min <= e and st["xmax"].max >= w and st["ymin"].min <= n and st["ymax"].max >= s:
            hits.append(rg)
    return hits


def read_file(key, box):
    fs = fsspec.filesystem("http", client_kwargs={"trust_env": True})
    url = f"{BUCKET}/{key}"
    with fs.open(url, block_size=4 * 1024 * 1024) as f:
        pf = pq.ParquetFile(f)
        rgs = overlapping_row_groups(pf.metadata, box)
        if not rgs:
            return None
        t = pf.read_row_groups(rgs)
    w, s, e, n = box
    b = t.column("bbox").combine_chunks()
    import pyarrow.compute as pc
    mask = pc.and_(
        pc.and_(pc.less_equal(b.field("xmin"), e), pc.greater_equal(b.field("xmax"), w)),
        pc.and_(pc.less_equal(b.field("ymin"), n), pc.greater_equal(b.field("ymax"), s)),
    )
    return t.filter(mask)


def main():
    release, theme, typ, *rest = sys.argv[1:]
    box = tuple(map(float, rest[:4]))
    out = rest[4]
    keys = list_keys(f"release/{release}/theme={theme}/type={typ}/")
    print(f"{len(keys)} files; scanning footers...", file=sys.stderr)
    with ThreadPoolExecutor(16) as ex:
        tables = [t for t in ex.map(lambda k: read_file(k, box), keys) if t is not None and t.num_rows]
    table = pa.concat_tables(tables, promote_options="permissive")
    pq.write_table(table, out)
    print(f"wrote {table.num_rows} rows to {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
