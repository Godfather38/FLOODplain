# Version 3: primary and secondary river-path closure

Original request: “I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.”

Version 2 in the parent directory is preserved. Its closure check used only dnhydroseq and was incomplete. Version 3 follows both dnhydroseq and dnminorhyd, including paths through external reaches, and adds all intervening reaches that leave and re-enter the active area. No flow split fractions, flow subtraction, synthetic catchment polygons or solver runs were introduced.

## Northern: ready for native preparation

Use northern-domain.geojson, northern-catchments.geojson, northern-boundary-registry.json and northern-forecast/history.json.

Internalized 945050484,945050485,945050487. Removed external injection at 485 and 487. The three minor links 478→487,479→483,480→484 are now internal. Eight actual external inlets remain, with complete frozen forecast/history files.

945050487 is a river branch with official areasqkm=0 and no catchment polygon returned by the exact official query. Its 120.037 m line lies entirely within the prepared domain. It remains in activeReachIds, separately from activeCatchmentReachIds. No polygon was invented.

## Picture Rocks/Ina/Twin Peaks

No geometry or inlet changes. Seven external inlets, complete frozen inputs. No active or inlet secondary-link correction was needed.

## Gates

An exact downstream lookup exposed 15876867→15876857→15876851→15876847. Version 3 adds the two connecting catchments and internalizes former inlet 15876851. Only old components 1 and 4 merge; both were already excluded from the parent's supported Gates case because of terrain gaps. The remaining nine components remain separate in the full inspected directed graph. This does not prove absence of cross-divide overland exchange.

The full Gates case now needs upstream 15876849→15876851. Its original frozen forecast and analysis history have now been acquired with the same native feature-ID checks. Full Gates forcing files are complete with nine external inlet series. The other eight series are unchanged; the terrain gap still blocks full Gates execution.

All three version 3 registries have no unresolved active/inlet downstream IDs, no external split requiring an assumed fraction, and no repeated cumulative inlet chain in the inspected network. Existing records at the broader network edge remain an audit boundary, not proof of nationwide topology completeness. Native boundary placement remains the parent's task.

