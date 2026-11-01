"""Windowed import of professional 2021 terrain and WorldCover, no terrain edits."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import requests
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

BOUNDS = (467000, 3577000, 493500, 3596000)
WORLDCOVER = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N30W114_Map.tif'
MAPPING = 'https://raw.githubusercontent.com/Deltares/hydromt_sfincs/v1.2.2/hydromt_sfincs/data/lulc/esa_worldcover_mapping.csv'
REPORT = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/metadata/AZ_PimaCounty_2021_B21/AZ_PimaCo_2_2021/reports/Final_37174_AZ_PimaCounty_D2_Report.pdf'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    catalog_path = a.output/'tnm-catalog.json'
    if not catalog_path.exists():
        response = requests.get('https://tnmaccess.nationalmap.gov/api/v1/products', params={
            'datasets': 'Digital Elevation Model (DEM) 1 meter',
            'bbox': '-111.37,32.31,-111.05,32.52', 'max': 100}, timeout=60)
        response.raise_for_status(); catalog_path.write_bytes(response.content)
    catalog = json.loads(catalog_path.read_text())
    if catalog['total'] > len(catalog['items']):
        raise ValueError('Incomplete TNM catalog')
    tiles = [i for i in catalog['items'] if 'AZ_PimaCounty_2021_B21' in i['title']]
    if len(tiles) != 12:
        raise ValueError('Unexpected 2021 tile catalog; inspect before import')
    xmin,ymin,xmax,ymax = BOUNDS
    transform = from_origin(xmin,ymax,10,10)
    width,height = int((xmax-xmin)/10),int((ymax-ymin)/10)
    profile = dict(driver='GTiff',width=width,height=height,count=1,crs='EPSG:32612',
                   transform=transform,compress='deflate',tiled=True)
    source_records=[]
    env=dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
             GDAL_HTTP_TIMEOUT='60',GDAL_HTTP_MAX_RETRY='2')
    with rasterio.Env(**env):
        for i,tile in enumerate(tiles):
            path=a.output/f'terrain-part-{i:02d}.tif'
            url=tile['downloadURL']
            if not url.startswith('https://prd-tnm.s3.amazonaws.com/'):
                raise ValueError('Unexpected terrain host')
            if not path.exists():
                with rasterio.open(url) as source:
                    if source.crs.to_epsg()!=26912 or source.count!=1:
                        raise ValueError('Unexpected terrain CRS/bands')
                    with WarpedVRT(source,crs=profile['crs'],transform=transform,width=width,height=height,
                                   resampling=Resampling.bilinear,nodata=-9999) as vrt:
                        data=vrt.read(1)
                    with rasterio.open(path,'w',**profile,dtype='float32',nodata=-9999) as dst:dst.write(data,1)
                print(f'Terrain tile {i+1}/12 imported using remote overviews/window',flush=True)
            source_records.append({'url':url,'title':tile['title'],'publicationDate':tile['publicationDate'],
                                   'catalogSourceId':tile['sourceId'],'derivedWindowSha256':digest(path)})
        out=np.full((height,width),-9999,dtype=np.float32)
        for i in range(len(tiles)):
            with rasterio.open(a.output/f'terrain-part-{i:02d}.tif') as src:
                data=src.read(1,masked=True)
                take=(out==-9999)&~np.ma.getmaskarray(data)
                out[take]=data.data[take]
        if not np.isfinite(out).all() or (out==-9999).any():
            raise ValueError('2021 terrain has uncovered cells; no filling allowed')
        terrain=a.output/'terrain.tif'
        with rasterio.open(terrain,'w',**profile,dtype='float32',nodata=-9999) as dst:
            dst.write(out,1);dst.update_tags(vertical_datum='NAVD88',vertical_units='metres',
                                           acquisition_window='2021-09-27/2021-11-17')
        lulc=a.output/'lulc.tif'
        if not lulc.exists():
            with rasterio.open(WORLDCOVER) as source:
                with WarpedVRT(source,crs=profile['crs'],transform=transform,width=width,height=height,
                               resampling=Resampling.nearest,nodata=0) as vrt:data=vrt.read(1)
                if (data==0).any():raise ValueError('Missing WorldCover cells')
                with rasterio.open(lulc,'w',**profile,dtype='uint8',nodata=0) as dst:dst.write(data,1)
        mapping=a.output/'esa_worldcover_mapping.csv'
        if not mapping.exists():
            r=requests.get(MAPPING,timeout=60);r.raise_for_status();mapping.write_bytes(r.content)
    manifest={'schemaVersion':1,'retrievedUtc':datetime.now(timezone.utc).isoformat(),
              'crs':'EPSG:32612','sourceTerrainCrs':'EPSG:26912','verticalDatum':'NAVD88',
              'geoid':'GEOID18 per professional project report','elevationUnits':'m',
              'acquisitionWindow':'2021-09-27/2021-11-17','acquisitionEvidence':REPORT,
              'metadataCaveat':'Vendor XML includes inconsistent 2022 date; flight-log window retained',
              'terrainMethod':'Rasterio/GDAL standard bilinear overview reprojection to 10m; no filling/burning',
              'roughnessMethod':'WorldCover2021 nearest-neighbor crop; official HydroMT-SFINCS1.2.2 class mapping',
              'bounds':BOUNDS,'resolutionM':10,'shape':[height,width],
              'terrainRangeM':[float(out.min()),float(out.max())],'missingTerrainCells':0,
              'sources':source_records,'worldcoverUrl':WORLDCOVER,'mappingUrl':MAPPING,
              'artifacts':[{'path':p.name,'sha256':digest(p)} for p in [terrain,lulc,mapping,catalog_path]],
              'limitations':['2021 survey is not 2026 construction geometry',
                             '10m resampling may lose small channel/structure detail',
                             'WorldCover roughness is a published class mapping, not measured channel friction',
                             'No infiltration or initial state supplied by these rasters']}
    (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'manifest':str(a.output/'manifest.json'),'range':manifest['terrainRangeM']},indent=2))


if __name__=='__main__':main()
