"""Versioned interpretation of the audited September 2014 IEM p1h writer."""
PROFILE='iem-september-2014-integer-mm-zero-ambiguous-v1'
REVISION='d592553cfd01baac8cb8ebc10f9217e21d7c5def'
BASE=f'https://github.com/akrherz/iem/blob/{REVISION}/'
SOURCES={
 'hourlyWriter':BASE+'scripts/mrms/mrms_raster_p1h.py',
 'dailyWriter':BASE+'scripts/mrms/mrms_raster_pXXh.py',
 'reader':BASE+'scripts/mrms/util.py',
 'scheduler':BASE+'scripts/RUN_10_AFTER.sh',
 'historicalMissingWarning':BASE+'htdocs/rainfall/index.phtml',
 'gridFix':'https://github.com/akrherz/pyIEM/commit/fbaa69a08233574c5727e87bdd22fd73df088041'
}
WARNING='Historical p1h writer stored integer mm, bypassing its palette conversion. Zero cannot distinguish dry, sub-mm truncation, or missing data: retained as null. Raw NSSL headers were not obtained, so other cast/wrap artifacts cannot be ruled out. Not calibrated or complete rainfall forcing.'

def legacy2014_mm(index):
    if not isinstance(index,int) or not 0<=index<=255:raise ValueError('Invalid rainfall byte')
    return None if index in (0,255) else float(index)

def native_centers(world):
    if world!=[.01,0,0,-.01,-130,55]:raise ValueError('Expected audited legacy world-file layout')
    return [.01,0,0,-.01,-129.995,54.995]
