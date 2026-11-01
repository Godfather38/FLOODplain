# July 2013 source audit after failed SFINCS event

Re-read all 96 original GRIB files independently of the export loop. Every original SHA-256 matches provenance. Actual GRIB validity timestamps are July 19 08Z through July 23 07Z, each an exactly one-hour accumulation; exported interval starts are one hour earlier. Full YYYYMMDDHH cache names and embedded dates rule out a 2014 cache collision.

All **69,696 exported values match the raw decoded values and bitmap exactly**. Parameter 61, table 2, `tp/accum`, `kg m**-2`, step units hours, and one-hour duration are consistent. One kg/m² water is one mm; no extra scaling occurs. Native polar-stereographic grid identity and orientation match the retained mapping. Independent ecCodes nearest lookups at the crop corners and center match exported native indices. The crop remains [-111.37,32.31,-111.05,32.52]. No missing values were filled. No source/units/time/export error was found in these checks.

The [public audit artifact](../public/simulation/data/stage4-2013-source-audit.json) retains each hour's metadata, point samples, eight raw daily summaries and the raw July 20 METAR CSV. The reproducible audit script is `tools/simulation/audit_stage4_2013.py`.

## Public gauge comparison, not a correction factor

Tucson airport on July 20: archived daily precipitation **0.81 inches = 20.574 mm**, `precip_est: false`, versus **8.75 mm** in the nearest Stage IV native cell. Raw METAR records also contain nonzero precipitation groups. This is a real point-versus-grid discrepancy, south of the modeled reach; it does not prove a reach-wide multiplier or explain the 99.96% discharge miss. Stage IV may use gauges in its analysis, so the comparison is not wholly independent rainfall validation.

Ryan Field's July 20 daily summary reports zero while its nearby Stage IV cell totals **59.63 mm**. Only ten raw METAR reports were returned; inspected reports lack explicit precipitation groups. Treat the zero's measurement completeness as unresolved, **not proof that Stage IV rainfall was false**. Do not sum special-report `p01i` values because their intervals overlap. Trace summaries (`0.0001`) are labeled trace rather than converted into precise rainfall amounts, following [IEM precipitation documentation](https://mesonet.agron.iastate.edu/request/hourlyprecip.phtml). [IEM's raw-observation documentation](https://mesonet.agron.iastate.edu/request/download.phtml) explains the data's limited quality control and interval semantics.

The local reach export's total rainfall remains 0–18.26 mm. No values, timing, geometry or model parameters were changed. The solver team's separate boundary/source and geometry-vintage audit remains necessary; this audit establishes faithful extraction of the archived analysis, not physical accuracy everywhere.
