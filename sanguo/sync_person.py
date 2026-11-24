"""Append or refresh one completed character using a verified A3 PDF and source ZIP."""
from argparse import ArgumentParser
from base64 import b64encode
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import json,re

import fitz
from PIL import Image

def read_index(path):
    return json.loads(path.read_text().removeprefix('window.ATLAS = ').strip().removesuffix(';'))

def write_js(path,prefix,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(prefix+json.dumps(obj,ensure_ascii=False,separators=(',',':'))+';\n')

def uri(mime,raw):
    return 'data:'+mime+';base64,'+b64encode(raw).decode('ascii')

def photograph(img,limit,quality):
    img=img.convert('RGB')
    img.thumbnail(limit)
    with BytesIO() as target:
        img.save(target,'WEBP',quality=quality)
        return uri('image/webp',target.getvalue())

def printable(img):
    with BytesIO() as jpeg,fitz.open() as output:
        img=img.copy()
        img.thumbnail((2400,1700))
        img.save(jpeg,'JPEG',quality=76,optimize=True)
        page=output.new_page(width=1190.551,height=841.890)
        page.insert_image(page.rect,stream=jpeg.getvalue())
        return uri('application/pdf',output.tobytes(garbage=4,deflate=True))

def normalize(raw):
    person={k:raw.get(k) for k in ('id','name','courtesy','span')}
    person['slug']=person['id'].lower()
    if not re.fullmatch(r'sg-\d{3,}',person['slug']):
        raise ValueError('Invalid character number')
    if not person['span']:
        person['span']=f"{raw.get('born') or '生年不详'} — {raw.get('died') or '卒年不详'}"
    for k in ('routes','waypoints','note'):
        person[k]=raw.get(k) or {'routes':[],'waypoints':{},'note':''}[k]
    sources=raw.get('sources') or {}
    person['sources']=sources if isinstance(sources,list) else [
        dict(id=k,title=k,url=v) for k,v in sources.items() if isinstance(v,str)]
    person['events']=[]
    for i,event in enumerate(raw['events'],1):
        year=str(event.get('year',''))
        point=event.get('point',[event.get('lon'),event.get('lat')])
        if not isinstance(point,(list,tuple)) or len(point)!=2 or not all(isinstance(v,(float,int)) for v in point):
            point=None
        if point and not (99<=point[0]<=128 and 21.3<=point[1]<=43.2):
            raise ValueError(f'Point outside current atlas extent: {point}')
        person['events'].append(dict(n=event.get('n',i),year=year,place=event['place'],
            years=[int(y) for y in re.findall(r'(?<!\d)\d{3}(?!\d)',year)],
            modern=event.get('modern',event.get('now','')),point=point,phase=event.get('phase',0),
            title=event.get('headline',event.get('caption','')),body=event.get('story',event.get('desc','')),
            scope=event.get('scope',event.get('role','')),note=event.get('note',''),source=event.get('source')))
    return person

def rgb(pix):
    return Image.frombytes('RGB',(pix.width,pix.height),pix.samples)

def sync(directory,pdf,archive,replace=False):
    index=directory/'atlas-data.js'
    people=read_index(index)
    with ZipFile(archive) as files:
        data_files=[n for n in files.namelist() if '事件与地理数据' in n and n.endswith('.json')]
        if len(data_files)!=1:
            raise ValueError('Expected exactly one character in the source ZIP')
        person=normalize(json.loads(files.read(data_files[0])))
        portraits=[n for n in files.namelist() if n.endswith(('/portrait_original.png','/portrait.png','/portrait.jpg'))]
        if not portraits:
            raise ValueError('Missing portrait')
        portrait=Image.open(BytesIO(files.read(min(portraits,key=lambda name:('original' not in name,len(name))))))
        person['thumb']=photograph(portrait,(275,420),78)
        large_portrait=photograph(portrait,(480,700),82)
    slug=person['slug']
    existing=next((p for p in people if p['slug']==slug),None)
    if existing and (not replace or existing['name']!=person['name']):
        raise ValueError(f'Already has {slug} {existing["name"]}')
    if not person['events'] or len({e['n'] for e in person['events']})!=len(person['events']):
        raise ValueError('Missing event data or repeated event numbers')
    with fitz.open(pdf) as doc:
        if len(doc)!=1 or abs(doc[0].rect.width-1190.55)>1 or abs(doc[0].rect.height-841.89)>1:
            raise ValueError('Expected a single-page landscape A3 PDF')
        page=doc[0]
        if person['name']+'大事年表' not in page.get_text():
            raise ValueError('PDF does not match the character in the ZIP')
        poster=rgb(page.get_pixmap(matrix=fitz.Matrix(2.25,2.25),alpha=False))
        cell=(page.rect.width-36)/len(person['events'])
        scenes={}
        for i,event in enumerate(person['events']):
            x=20+i*cell
            tile=fitz.Rect(x,692,x+cell-4,765)
            scenes[event['n']]=photograph(rgb(page.get_pixmap(matrix=fitz.Matrix(2.6,2.6),clip=tile)),(270,200),78)
        pack=dict(portrait=large_portrait,poster=photograph(poster,(2250,1650),82),
                  pdf=printable(poster),scenes=scenes)
    people=[p for p in people if p['slug']!=slug]+[person]
    people.sort(key=lambda item:int(item['slug'][3:]))
    write_js(directory/'assets'/f'{slug}.js',"window.ATLAS_MEDIA["+repr(slug)+"] = ",pack)
    write_js(index,'window.ATLAS = ',people)
    print(f'{slug} {person["name"]}: {len(person["events"])} events; atlas: {len(people)} characters')

if __name__=='__main__':
    cli=ArgumentParser(description=__doc__)
    cli.add_argument('directory',type=Path)
    cli.add_argument('pdf',type=Path)
    cli.add_argument('zip',type=Path)
    cli.add_argument('--replace',action='store_true')
    args=cli.parse_args()
    sync(args.directory,args.pdf,args.zip,args.replace)
