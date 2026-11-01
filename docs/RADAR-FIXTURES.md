# Real rainfall ingestion

Two bounded public binary fixtures are committed, along with derived normalized inputs and original SHA-256 hashes. No credentials or paid sources are used. The denied NOAA directory was not retried: these are independently published NOAA OpenData and Iowa Environmental Mesonet distributions.

- NOAA GRIB2: https://noaa-mrms-pds.s3.amazonaws.com/CONUS/PrecipRate_00.00/20201014/MRMS_PrecipRate_00.00_20201014-000000.grib2.gz (657543 bytes). Official registry: https://registry.opendata.aws/noaa-mrms-pds/ . This is **2020 parser validation**, not September 2014 rainfall. The local terrain sample is dry.
- IEM historical quantitative PNG: https://mesonet.agron.iastate.edu/archive/data/2014/09/08/GIS/mrms/p1h_201409081800.png and matching `.wld` (392390 bytes PNG). This supplies one hour, **17:00–18:00 UTC September 8, 2014**, with 10–19 mm under the source-versioned integer-mm profile and corrected native centers across the 81 local terrain samples. It is not a complete storm or full upstream basin.

`decode_rainfall.py` uses the established ECMWF ecCodes decoder (Apache 2.0) for GRIB2 and Pillow for indexed PNG. It validates GRIB edition, size, product numeric identity, analysis time, grid orientation and coordinates. ecCodes reports this local product's name/units as unknown; the numeric identity is checked and mm/h comes from the NOAA product table, not an invented library alias: https://www.nssl.noaa.gov/projects/mrms/operational/tables.php . Negative missing/no-coverage pixels are rejected rather than filled with zero. The test independently decodes PNG-packed values at dry, wet (103.8 mm/h) and no-coverage (-3) anchors and compares ecCodes.

IEM's indexed PNG is numerical data, not RGB rain colors. **The September 2014 p1h writer bypassed palette encoding: nonzero bytes are integer mm and zero is ambiguous.** The original modern-palette interpretation is retained only as obsolete history. See RAINFALL-SOURCE-AUDIT.md. Index 255 is missing. The piecewise mapping is retained for p24h and modern products, not the audited legacy p1h bytes. Current general references are https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=5 and https://mesonet.agron.iastate.edu/rainfall/ . Hourly accumulation is divided by one hour for a constant hourly mean rate; actual subhour timing is unknown. The single-hour decoder accepts only the audited September 2014 p1h profile: do not reuse the scale for a2m or combine overlapping rolling accumulations. IEM public data-use terms: https://mesonet2.agron.iastate.edu/disclaimer.php . Attribution is retained; derivatives are clearly labeled radar estimates.

```sh
python -m pip install -r tools/simulation/requirements-radar.txt
python tools/simulation/decode_rainfall.py
python -m unittest discover -s test -p 'radar_fixture_test.py' -v
npm test
node tools/simulation/serve.mjs
```

Open the local index and choose **Replay 2014 radar hour** or **Replay NOAA GRIB fixture**. Default stays synthetic. The corrected local wet-hour rates range from 10 to 19 mm/h; infiltration choices remain uncalibrated scenarios. Node tests feed the actual decoded hour through the runoff engine with zero infiltration to verify volume and mass conservation. Python decoding is covered by a separate non-deploying CI workflow. The older wgrib2 CSV path remains synthetic-tested; the validated binary path is ecCodes.

The 250 m / 81-point terrain window remains clipped and contains unresolved pits. These real rainfall inputs do not turn it into a delineated basin, a road-depth model, a full 2014 reconstruction, or a calibrated forecast. Obtain the complete event and conditioned basin before attempting rainfall-driven crossing predictions. Official forecasts use the separate app engine described in FORECAST-ENGINE.md.
