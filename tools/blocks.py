import struct,sys
d=open(sys.argv[1],'rb').read()
size,hv,ver,boff,bcnt=struct.unpack('<IHHII',d[:16])
print('size',size,'hdrver',hv,'ver',ver,'blocks',bcnt)
base=8
for i in range(bcnt):
    p=base+boff+i*12
    name=d[p:p+4]; off,ln=struct.unpack('<II',d[p+4:p+12])
    s=p+4+off
    print(name,off,ln,'abs',s, d[s:s+min(ln,64)])
