"""Makes every clip in the finals deck start by itself when its slide opens (PowerPoint's "Start: Automatically").
pptxgenjs embeds videos as "play on click"; this adds the slide timing PowerPoint writes for autoplay.
Usage: python3 autoplay.py out/KBC-Momentum-finals.pptx  (after node deck.js)"""
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

TIMING = """<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>\
<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>\
<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>\
<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>\
<p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>\
<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="{ms}" fill="hold"/><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:cmd>\
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>\
</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>\
<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>\
<p:video><p:cMediaNode vol="80000" mute="1"><p:cTn id="7" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn>\
<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cMediaNode></p:video>\
</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>"""


def main(deck: Path) -> None:
    clips = {}
    import json
    for v in json.loads((deck.parent / 'video-slides.json').read_text()):
        clips[v['index']] = v['ms']
    tmp = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(deck) as z:
        z.extractall(tmp)
    for index, ms in clips.items():
        slide = tmp / 'ppt' / 'slides' / f'slide{index}.xml'
        xml = slide.read_text(encoding='utf-8')
        m = re.search(r'<p:cNvPr id="(\d+)" name="clip [^"]+"', xml)
        if not m or '<p:timing>' in xml:
            continue
        timing = TIMING.format(ms=ms, spid=m.group(1))
        xml = xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + timing, 1)
        slide.write_text(xml, encoding='utf-8')
    out = deck.with_suffix('.tmp.pptx')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml first, as Office writes it
        files = sorted(tmp.rglob('*'), key=lambda p: (p.name != '[Content_Types].xml', str(p)))
        for f in files:
            if f.is_file():
                z.write(f, f.relative_to(tmp).as_posix())
    shutil.move(out, deck)
    shutil.rmtree(tmp)
    print(f'{deck}: autoplay on {len(clips)} clips')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
