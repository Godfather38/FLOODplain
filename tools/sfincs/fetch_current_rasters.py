"""Windowed import of professional 2021 terrain and WorldCover, no terrain edits."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import requests
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import Window
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
    p.add_argument('--bounds', nargs=4, type=float, default=BOUNDS)
    p.add_argument('--active-domain',type=Path,help='Require all subgrid pixels in centre-selected 100m active cells; retain nodata elsewhere')
    p.add_argument('--base-cache', type=Path, help='Reuse existing prepared rasters; retrieve only missing windows')
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    bounds=tuple(a.bounds)
    tx=Transformer.from_crs(32612,4326,always_xy=True)
    corners=[tx.transform(x,y) for x in [bounds[0],bounds[2]] for y in [bounds[1],bounds[3]]]
    bbox=[min(p[0] for p in corners)-.001,min(p[1] for p in corners)-.001,max(p[0] for p in corners)+.001,max(p[1] for p in corners)+.001]
    catalog_path = a.output/'tnm-catalog.json'
    if not catalog_path.exists():
        response = requests.get('https://tnmaccess.nationalmap.gov/api/v1/products', params={
            'datasets': 'Digital Elevation Model (DEM) 1 meter',
            'bbox': ','.join(map(str,bbox)), 'max': 100}, timeout=60)
        response.raise_for_status(); catalog_path.write_bytes(response.content)
    catalog = json.loads(catalog_path.read_text())
    if catalog['total'] > len(catalog['items']):
        raise ValueError('Incomplete TNM catalog')
    tiles = [i for i in catalog['items'] if 'AZ_PimaCounty_2021_B21' in i['title']]
    # Preserve cached 2021 indices; append the verified 2023 edge product only.
    tiles += [i for i in catalog['items'] if i['title']=='USGS 1 Meter 12 x49y361 AZ_NorthCentral_B23']
    if not tiles:
        raise ValueError('Unexpected 2021 tile catalog; inspect before import')
    xmin,ymin,xmax,ymax = bounds
    transform = from_origin(xmin,ymax,10,10)
    width,height = int((xmax-xmin)/10),int((ymax-ymin)/10)
    profile = dict(driver='GTiff',width=width,height=height,count=1,crs='EPSG:32612',
                   transform=transform,compress='deflate',tiled=True)
    source_records=[]
    out=np.full((height,width),-9999,dtype=np.float32)
    if a.base_cache:
        with rasterio.open(a.base_cache/'terrain.tif') as source:
            with WarpedVRT(source,crs=profile['crs'],transform=transform,width=width,height=height,
                           resampling=Resampling.nearest,nodata=-9999) as vrt:out=vrt.read(1)
        print('Reused base terrain cells: '+str(int((out!=-9999).sum())),flush=True)
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
                        data=np.full((height,width),-9999,dtype=np.float32)
                        # Read only row-block windows still absent from the existing mosaic.
                        for row in range(0,height,256):
                            h=min(256,height-row);missing=out[row:row+h]==-9999
                            cols=np.flatnonzero(missing.any(axis=0))
                            if not len(cols):continue
                            c0,c1=int(cols[0]),int(cols[-1])+1
                            values=vrt.read(1,window=Window(c0,row,c1-c0,h))
                            data[row:row+h,c0:c1]=values
                    with rasterio.open(path,'w',**profile,dtype='float32',nodata=-9999) as dst:dst.write(data,1)
                print(f'Terrain tile {i+1}/{len(tiles)} imported missing windows',flush=True)
            with rasterio.open(path) as part:
                arr=part.read(1,masked=True);take=(out==-9999)&~np.ma.getmaskarray(arr);out[take]=arr.data[take]
            source_records.append({'url':url,'title':tile['title'],'publicationDate':tile['publicationDate'],
                                   'catalogSourceId':tile['sourceId'],'acquisitionWindow':('2023-06-01/2023-08-11' if 'NorthCentral' in tile['title'] else '2021-09-27/2021-11-17'),'derivedWindowSha256':digest(path)})
        required=np.ones(out.shape,dtype=bool)
        if a.active_domain:
            import geopandas as gpd
            from rasterio.features import geometry_mask
            geom=gpd.read_file(a.active_domain).to_crs(profile['crs'])
            # Standard centre-based 100m active mask; require every subgrid pixel in each active cell.
            coarse=geometry_mask(geom.geometry,(height//10,width//10),from_origin(xmin,ymax,100,100),invert=True,all_touched=False)
            required=coarse.repeat(10,axis=0).repeat(10,axis=1)
        if not np.isfinite(out[required]).all() or (out[required]==-9999).any():
            raise ValueError('Prepared terrain has uncovered active-cell subgrid pixels; no filling allowed')
        terrain=a.output/'terrain.tif'
        with rasterio.open(terrain,'w',**profile,dtype='float32',nodata=-9999) as dst:
            dst.write(out,1);dst.update_tags(vertical_datum='NAVD88',vertical_units='metres',
                                           acquisition_window='2021-09-27/2021-11-17; edge 2023-06-01/2023-08-11')
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
              'geoid':'2021 GEOID18 per project report; 2023 edge product NAVD88 per USGS metadata','elevationUnits':'m',
              'acquisitionWindow':'2021-09-27/2021-11-17; northern edge 2023-06-01/2023-08-11','acquisitionEvidence':REPORT,
              'edgeMetadata':'https://thor-f5.er.usgs.gov/ngtoc/metadata/waf/elevation/1_meter/geotiff/AZ_NorthCentral_B23/USGS_1M_12_x49y361_AZ_NorthCentral_B23.xml',
              'metadataCaveat':'Vendor XML includes inconsistent 2022 date; flight-log window retained',
              'terrainMethod':'Rasterio/GDAL standard bilinear overview reprojection to 10m; no filling/burning',
              'roughnessMethod':'WorldCover2021 nearest-neighbor crop; official HydroMT-SFINCS1.2.2 class mapping',
              'bounds':bounds,'baseCacheManifestSha256':digest(a.base_cache/'manifest.json') if a.base_cache else None,'resolutionM':10,'shape':[height,width],
              'terrainRangeM':[float(out[out!=-9999].min()),float(out[out!=-9999].max())],
              'missingTerrainCells':int((out==-9999).sum()),'missingRequiredTerrainCells':0,
              'requiredCoverage':'every 10m pixel in centre-selected 100m active cells' if a.active_domain else 'whole rectangle',
              'sources':source_records,'worldcoverUrl':WORLDCOVER,'mappingUrl':MAPPING,
              'artifacts':[{'path':p.name,'sha256':digest(p)} for p in [terrain,lulc,mapping,catalog_path]],
              'limitations':['2021 survey is not 2026 construction geometry',
                             '10m resampling may lose small channel/structure detail',
                             'WorldCover roughness is a published class mapping, not measured channel friction',
                             'No infiltration or initial state supplied by these rasters']}
    (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'manifest':str(a.output/'manifest.json'),'range':manifest['terrainRangeM']},indent=2))


if __name__=='__main__':main()
