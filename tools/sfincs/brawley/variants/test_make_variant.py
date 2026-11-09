"""Tests for make_variant.py base-inp refusals. Run: python -I tools/sfincs/brawley/variants/test_make_variant.py
Builds tiny fake case folders in a temp directory; nothing in the repo is touched."""
import json, subprocess, sys, tempfile
from pathlib import Path

MV = Path(__file__).resolve().parent / 'make_variant.py'


def case(tmp, name, inp):
    d = Path(tmp) / name
    d.mkdir()
    (d / 'sfincs.inp').write_bytes(inp.encode('utf-8'))
    (d / 'sfincs.nc').write_bytes(b'not read for --inp-set')
    (d / 'current-case.json').write_text(json.dumps({'case': name}) + '\n', encoding='utf-8')
    return d


def run(base, out, *sets):
    args = [sys.executable, '-I', str(MV), str(base), str(out), '--name', 't', '--source', 'test']
    for s in sets:
        args += ['--inp-set', s]
    return subprocess.run(args, capture_output=True, text=True)


def main():
    good = 'alpha                = 0.5\nbtfilter             = 60.0\ntheta                = 1.0\n'
    cases = {
        'ok': (good, True),
        'dup-other-key': (good + 'theta                = 0.9\n', False),       # duplicate of a key NOT being set
        'dup-case-other-key': (good + 'THETA                = 0.9\n', False),  # case-variant duplicate
        'wrong-case-other-key': ('Alpha                = 0.5\nbtfilter             = 60.0\n', False),
        'dup-set-key': (good + 'btfilter             = 30.0\n', False),
    }
    fails = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, (inp, expect_ok) in cases.items():
            base = case(tmp, name, inp)
            out = Path(tmp) / (name + '-out')
            r = run(base, out, 'btfilter=-1')
            ok = r.returncode == 0
            good_result = ok == expect_ok and (out.exists() == expect_ok)
            if expect_ok and ok:
                good_result &= 'btfilter             = -1' in (out / 'sfincs.inp').read_text(encoding='utf-8')
            if not expect_ok:
                good_result &= 'refusing' in (r.stderr + r.stdout)
            print(('PASS' if good_result else 'FAIL'), name, (r.stderr or r.stdout).strip().splitlines()[-1:] if not ok else '')
            fails += not good_result
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
