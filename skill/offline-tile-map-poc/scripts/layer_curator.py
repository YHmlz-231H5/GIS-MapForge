#!/usr/bin/env python3
"""
layer_curator.py -- Interactive shell helper for Phase 8a layer curation.

Companion to `references/pmtiles-layer-curator.md`. When the agent arrives at
Phase 8a (after Phase 1 research, before any PBF->PMTiles or custom style.json),
it should ask the user these 6 questions.

This script provides:
1. A non-interactive defaults mode: --preset city --print so the agent
   can emit the layer choices without a clarify() round-trip when the user
   has implicitly accepted defaults.
2. An interactive mode (no args) for human-only use.
3. A canonical emit-style snippet from the chosen preset -- drop the
   matching styleLayers array into demo/index.html.

The 6 questions + defaults match references/pmtiles-layer-curator.md
exactly. Update them in BOTH places if they diverge.

Usage:
    # Auto-pick city preset (Longhua aesthetic) + style snippet:
    python scripts/layer_curator.py --preset city --emit-style

    # Show all presets and their layer selections:
    python scripts/layer_curator.py --list

    # Interactive:
    python scripts/layer_curator.py
"""
import argparse
import json
import sys

# Canonical presets from references/pmtiles-layer-curator.md.
PRESETS = {
    "overview": {
        "purpose": "overview",
        "zoom_band": "0-6",
        "use_case": "country / continent / state",
        "layers": {
            "bg": True,
            "landcover": True,
            "landuse": False,
            "park": False,
            "water": True,
            "waterway": False,
            "water_name": True,
            "boundary": True,
            "transportation": False,        # roads at z<4 are extremely thin
            "transportation_name": False,
            "building": False,
            "poi": False,
            "place_cities": True,
            "place_towns": False,
            "place_labels": True,
            "mountain_peak": True,
            "aerodrome_label": True,
            "boundary_state": True,         # admin_level in {3,4}
            "aeroway_polygons": False,
        },
    },
    "city": {
        "purpose": "city",
        "zoom_band": "8-14",
        "use_case": "city / district / neighbourhood",
        "layers": {
            "bg": True,
            "landcover": True,
            "landuse": True,
            "park": True,
            "water": True,
            "waterway": True,
            "water_name": True,
            "boundary": True,
            "transportation": True,         # always include!
            "transportation_name": True,    # the layer agents forget most
            "building": "z13+",
            "poi": False,                    # user 2026-07-18: not needed
            "place_cities": True,
            "place_towns": True,
            "place_labels": True,
            "mountain_peak": False,
            "aerodrome_label": False,
            "boundary_state": True,
            "aeroway_polygons": False,
        },
    },
    "street": {
        "purpose": "street",
        "zoom_band": "12-14",
        "use_case": "street-level navigation",
        "layers": {
            "bg": True,
            "landcover": False,
            "landuse": True,
            "park": True,
            "water": True,
            "waterway": True,
            "water_name": True,
            "boundary": True,
            "transportation": True,
            "transportation_name": True,
            "building": True,               # full building footprints
            "poi": True,                     # POIs allowed at street-level
            "place_cities": True,
            "place_towns": True,
            "place_labels": True,
            "mountain_peak": False,
            "aerodrome_label": True,
            "boundary_state": False,
            "aeroway_polygons": True,
        },
    },
    "route": {
        "purpose": "route",
        "zoom_band": "0-14",
        "use_case": "driving directions / pathfinding",
        "layers": {
            "bg": True,
            "landcover": False,
            "landuse": False,
            "park": False,
            "water": True,
            "waterway": True,
            "water_name": False,
            "boundary": False,
            "transportation": True,         # only road geometry matters here
            "transportation_name": False,
            "building": False,
            "poi": False,
            "place_cities": True,
            "place_towns": False,
            "place_labels": False,
            "mountain_peak": False,
            "aerodrome_label": False,
            "boundary_state": False,
            "aeroway_polygons": False,
        },
    },
}


def emit_style(preset_name):
    """Emit a MapLibre-style style snippet for the chosen preset, ready to drop
    into demo/index.html styleLayers function."""
    preset = PRESETS[preset_name]
    layers = preset["layers"]
    out = []

    bg_color = "#dbe6f0" if preset_name == "overview" else "#dbe6f0"
    out.append(f"""    {{ id: `${{sourceId}}-bg`, type: "background", paint: {{"background-color": "{bg_color}"}} }},""")

    if layers["landcover"]:
        out.append("""    { id: `${sourceId}-landcover`, type: "fill", source: sourceId, "source-layer": "landcover",
      paint: {"fill-color": ["match", ["get","class"],
        "grass","#c8e0b4","wood","#aed1a0","forest","#aed1a0",
        "scrub","#bcd1a0","wetland","#c8dccc","farmland","#e8e0c0",
        "#dde4d4"], "fill-opacity": 0.7} },""")
    if layers["park"]:
        out.append("""    { id: `${sourceId}-park`, type: "fill", source: sourceId, "source-layer": "park",
      paint: {"fill-color": "#a8d5a0", "fill-opacity": 0.5} },""")
    if layers["landuse"]:
        out.append("""    { id: `${sourceId}-landuse`, type: "fill", source: sourceId, "source-layer": "landuse",
      paint: {"fill-color": ["match", ["get","class"],
        "residential","#ecead8","commercial","#e8d8e0",
        "industrial","#d8d8d8","cemetery","#d0d8c0",
        "hospital","#f2dada","school","#f2e8d0","park","#c5e8c1",
        "military","#e0c0c0","#e8e4d4"], "fill-opacity": 0.4} },""")
    if layers["water"]:
        out.append("""    { id: `${sourceId}-water`, type: "fill", source: sourceId, "source-layer": "water",
      paint: {"fill-color": "#9ec9e0", "fill-opacity": 0.85} },""")

    boundary_admin = 6 if layers["boundary_state"] else 4
    out.append(f"""    {{ id: `${{sourceId}}-boundary`, type: "line", source: sourceId, "source-layer": "boundary",
      filter: ["<=", ["get", "admin_level"], {boundary_admin}],
      paint: {{"line-color": "#9c89a8", "line-width": 1, "line-dasharray": [3, 2]}} }},""")
    if layers["waterway"]:
        out.append("""    { id: `${sourceId}-waterway`, type: "line", source: sourceId, "source-layer": "waterway",
      paint: {"line-color": "#9ec9e0", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2]} },""")

    if layers["aeroway_polygons"]:
        out.append("""    { id: `${sourceId}-aeroway`, type: "fill", source: sourceId, "source-layer": "aeroway",
      paint: {"fill-color": "#dcdcdc"} },""")

    if layers["building"]:
        mz = 12 if layers["building"] == "z13+" else 13
        out.append(f"""    {{ id: `${{sourceId}}-buildings`, type: "fill", source: sourceId, "source-layer": "building",
      minzoom: {mz},
      paint: {{"fill-color": "#d6c8a8", "fill-opacity": 0.7, "fill-outline-color": "#a89580"}} }},""")

    if layers["transportation"]:
        out.append("""    { id: `${sourceId}-roads`, type: "line", source: sourceId, "source-layer": "transportation",
      minzoom: 4,
      paint: {"line-color": ["match", ["get","class"],
        "motorway","#e892a2","motorway_link","#e892a2",
        "trunk","#f4a582","trunk_link","#f4a582",
        "primary","#fddbc7","secondary","#fddbc7","tertiary","#fee8d3",
        "minor","#ffffff","service","#f0f0f0","path","#c8b89a",
        "rail","#bbbbbb","aerialway","#7d3a4d","#ffffff"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 14, 2],
        "line-opacity": 0.9} },""")

    if layers["transportation_name"]:
        out.append("""    { id: `${sourceId}-road-labels`, type: "symbol", source: sourceId, "source-layer": "transportation_name",
      minzoom: 12, filter: ["==", ["geometry-type"], "LineString"],
      layout: {"text-field": ["coalesce", ["get", "name:zh"], ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 14, 13],
        "symbol-placement": "line", "text-anchor": "center"},
      paint: {"text-color": "#1a3a52", "text-halo-color": "#fff", "text-halo-width": 1.5} },""")

    if layers["poi"]:
        out.append("""    { id: `${sourceId}-pois`, type: "circle", source: sourceId, "source-layer": "poi",
      minzoom: 13,
      paint: {"circle-color": "#7a5230", "circle-radius": 2,
        "circle-stroke-color": "#fff", "circle-stroke-width": 0.5} },""")

    if layers["place_towns"]:
        out.append("""    { id: `${sourceId}-towns`, type: "circle", source: sourceId, "source-layer": "place",
      filter: ["in", ["get","class"], ["literal", ["town","village","suburb","hamlet","neighbourhood"]]],
      paint: {"circle-color": "#ef8a62", "circle-radius": 2,
        "circle-stroke-color": "#fff", "circle-stroke-width": 1} },""")

    if layers["place_cities"]:
        out.append("""    { id: `${sourceId}-cities`, type: "circle", source: sourceId, "source-layer": "place",
      filter: ["in", ["get","class"], ["literal", ["city","national_capital","state_capital"]]],
      paint: {"circle-color": "#b2182b", "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 14, 8],
        "circle-stroke-color": "#fff", "circle-stroke-width": 2} },""")

    if layers["place_labels"]:
        out.append("""    { id: `${sourceId}-place-labels`, type: "symbol", source: sourceId, "source-layer": "place",
      minzoom: 5,
      layout: {"text-field": ["coalesce", ["get", "name:zh"], ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 14, 14],
        "text-anchor": "top", "text-offset": [0, 0.5]},
      paint: {"text-color": "#333", "text-halo-color": "#fff", "text-halo-width": 1.5} },""")

    return "\n".join(out)


def emit_curation_log(preset_name):
    """Return the one-line summary that should be saved to docs/layer-curation.md."""
    p = PRESETS[preset_name]
    L = p["layers"]
    flags = []
    if L["transportation"] and L["transportation_name"]:
        flags.append("roads+labels")
    elif L["transportation"]:
        flags.append("roads-only")
    if L["building"]:
        flags.append("buildings=" + str(L["building"]))
    else:
        flags.append("buildings=off")
    if L["poi"]:
        flags.append("poi=on")
    else:
        flags.append("poi=off")
    if L["mountain_peak"]:
        flags.append("mountain=on")
    if L["aerodrome_label"]:
        flags.append("aerodrome=on")
    flags.append(f"purpose={p['purpose']}")
    flags.append(f"zoom={p['zoom_band']}")
    return f"# YYYY-MM-DD region=<name> preset={preset_name} " + " ".join(flags)


def print_preset(name):
    p = PRESETS[name]
    L = p["layers"]
    print(f'\n--- {name} ({p["purpose"]}) ---')
    print(f'Zoom band: {p["zoom_band"]}    Use case: {p["use_case"]}')
    print(f"Included layers:")
    for k, v in L.items():
        if v:
            print(f"   + {k:24s} {v if v is not True else ''}")
    print(f"Excluded layers:")
    for k, v in L.items():
        if not v:
            print(f"   - {k}")


def main():
    ap = argparse.ArgumentParser(description="Phase 8a layer curator.")
    ap.add_argument("--preset", choices=list(PRESETS.keys()),
                    help="Skip the 6 questions and use a canonical preset.")
    ap.add_argument("--list", action="store_true",
                    help="Show all preset layer selections and exit.")
    ap.add_argument("--print", action="store_true",
                    help="Print the chosen preset as JSON (machine-readable).")
    ap.add_argument("--emit-style", action="store_true",
                    help="Emit a MapLibre styleLayers array snippet for the chosen preset.")
    ap.add_argument("--emit-curation-log", action="store_true",
                    help="Emit the one-line text to save to docs/layer-curation.md.")
    args = ap.parse_args()

    if args.list:
        for name in PRESETS:
            print_preset(name)
        return

    if not args.preset:
        # Interactive fallback (rare in agent flow -- usually the agent
        # uses clarify() per the SKILL.md, not this script).
        print("Phase 8a: layer curation (interactive).")
        print("Available presets:", ", ".join(PRESETS))
        choice = input("Pick one (or 'q' to skip, defaults applied later): ").strip()
        if not choice or choice == "q":
            args.preset = "city"
            print("Using default: city")
        else:
            args.preset = choice

    if args.print:
        print(json.dumps({"preset": args.preset, **PRESETS[args.preset]}, indent=2))
    elif args.emit_style:
        print(emit_style(args.preset))
    elif args.emit_curation_log:
        print(emit_curation_log(args.preset))
    else:
        print_preset(args.preset)
        print()
        print("Hint: pass --emit-style to get the styleLayers snippet to drop into demo/index.html")


if __name__ == "__main__":
    main()
