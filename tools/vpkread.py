import struct, sys, os, re
def read_cstr(f):
    b=bytearray()
    while True:
        c=f.read(1)
        if c in (b'\0',b''): return b.decode('utf-8','replace')
        b+=c
def parse(dirpath):
    entries={}
    with open(dirpath,'rb') as f:
        sig,ver=struct.unpack('<II',f.read(8))
        assert sig==0x55aa1234, hex(sig)
        if ver==2:
            tree_size,=struct.unpack('<I',f.read(4)); f.read(16)
        else:
            tree_size,=struct.unpack('<I',f.read(4))
        hdr=f.tell()
        while True:
            ext=read_cstr(f)
            if not ext: break
            while True:
                path=read_cstr(f)
                if not path: break
                while True:
                    name=read_cstr(f)
                    if not name: break
                    crc,pre,arch,off,ln,term=struct.unpack('<IHHIIH',f.read(18))
                    predata=f.read(pre)
                    full=(path.strip()+'/' if path.strip() else '')+name+'.'+ext
                    entries[full]=(arch,off,ln,predata)
        datastart=hdr+tree_size
    return entries,datastart
def extract(dirpath,entries,datastart,name):
    arch,off,ln,pre=entries[name]
    if arch==0x7fff:
        with open(dirpath,'rb') as f: f.seek(datastart+off); return pre+f.read(ln)
    base=dirpath[:-len('_dir.vpk')]
    with open(f"{base}_{arch:03d}.vpk",'rb') as f: f.seek(off); return pre+f.read(ln)
if __name__=='__main__':
    d=sys.argv[1]; cmd=sys.argv[2]
    e,ds=parse(d)
    if cmd=='ls':
        pat=re.compile(sys.argv[3]) if len(sys.argv)>3 else None
        for k in sorted(e):
            if not pat or pat.search(k): print(k, e[k][2]+len(e[k][3]))
    elif cmd=='x':
        out=sys.argv[3]; pat=re.compile(sys.argv[4])
        for k in e:
            if pat.search(k):
                p=os.path.join(out,k); os.makedirs(os.path.dirname(p),exist_ok=True)
                open(p,'wb').write(extract(d,e,ds,k))
