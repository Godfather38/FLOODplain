# Reach geometry evidence and current limits

The 2015 University of Arizona [Santa Cruz monitoring study](https://content.civicplus.com/api/assets/3a2eba4f-5938-4c26-8302-1ed10a06bf61), printed pages 6-9 and 22-24, was checked against the experimental model. Its Cortaro-to-Trico reach is 16.4 miles. It uses observed Cortaro discharge upstream and normal depth with a 0.003 slope downstream. Its September 2014 event is a calibration case, not independent validation. The report references `Fig.3-8.cross section summary.xls`; that workbook and original HEC-RAS geometry are not included in our inputs. The plotted cross sections use relative elevations and cannot safely supply absolute NAVD88 bed elevations alone.

What is actually incorporated: independent Cortaro discharge as upstream forcing and the same named river reach. What is NOT incorporated: surveyed cross-section geometry, calibrated roughness, sediment transport, or the report's downstream normal-depth boundary. Our Manning 0.04 is assumed; outer edges remain artificial zero-depth outlets. No claim that the study validates this SFINCS case is justified.

## Independent terrain and connectivity checks

The baseline's largest depth is near 32.361850877,-111.10363242: bed 622.2475 m NAVD88, maximum modeled depth 26.8837 m. The injection cell itself reaches only 1.1075 m. Raw TIFF and native solver bed agree exactly after the documented north/south row conversion. Thus this is not an array flip or water injected directly into the deepest cell.

The official USGS NLDI downstream flowline response is preserved in `tools/sfincs/data/cortaro-downstream-flowlines.json`. Its nearest distance to the depression cell center is 168.62 m. The gauge coordinate is 97.75 m from this mapped channel. The closest channel point is EPSG:32612 (491030.4313,3579398.6800), whose containing 100 m cell has bed 651.7187 m, versus 653.5493 m in the original gauge-coordinate cell. A bounded optional channel-placement comparison uses this independent geometry, not the lowest neighboring elevation or the target hydrograph. No terrain is carved or filled. NLDI is generalized hydrography, not a surveyed channel opening.

A source-locked 2011 USGS terrain export using catalog IDs 8924,8925,8927,8928 returned unmasked zero elevations, including at the depression. The plausibility guard rejected it. It is not a valid alternative historical surface and was not used in the solver.

## Rainfall and initial state

The 72-hour Stage IV case starts September 8 07Z from the preceding run's modeled water levels at that exact time. This is not observed initialization or a full velocity restart. The subsequent 96-hour input covers September 7-11 07Z with complete Stage IV rainfall and Cortaro observations, using an explicitly assumed dry initial state and excluding the first 24 hours from comparison. No missing rainfall is silently converted to dry conditions. Rainfall on the small area upstream of the Cortaro point may overlap water represented by the observed boundary; external tributary hydrographs remain absent.

The current evidence identifies unresolved channel/bank connectivity and historical terrain as limits; it does not establish that the depression is erroneous or authorize arbitrary terrain conditioning. Original 81.425 m3/s Trico peak results remain preserved in `data/reach-result`.
