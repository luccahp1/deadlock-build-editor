// pancomp: compiles Panorama source files (xml / css / js) into the Source 2
// resources Deadlock loads (vxml_c / vcss_c / vts_c).
//
// Each command takes a compiled file from the game as a template. The template
// supplies the header version, the RED2 edit-info block and the KV3 format id,
// and only the content blocks are rebuilt from our source.
//
//   pancomp layout <template.vxml_c> <in.xml> <out.vxml_c>
//   pancomp style  <template.vcss_c> <in.css> <out.vcss_c>
//   pancomp script <template.vts_c>  <in.js>  <out.vts_c>
//   pancomp vpk    <dir> <out_dir.vpk>       (pack every file under dir)
//   pancomp kv3    <file_c> <block>          (debug: print a block as KV3 text)

using System.IO.Hashing;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using ValveKeyValue;
using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes;
using ValveResourceFormat.Utils;

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: pancomp layout|style|script <template> <in> <out>  |  pancomp kv3 <file> <block>");
            return 2;
        }

        switch (args[0])
        {
            case "layout": CompileLayout(args[1], args[2], args[3]); break;
            case "style": CompileText(args[1], args[2], args[3], keepRed2: true); break;
            case "script": CompileText(args[1], args[2], args[3], keepRed2: true); break;
            case "vpk": PackVpk(args[1], args[2]); break;
            case "kv3": PrintBlock(args[1], args[2]); break;
            default: Console.Error.WriteLine($"unknown command {args[0]}"); return 2;
        }

        return 0;
    }

    sealed record TemplateBlock(string Type, byte[] Bytes);

    sealed record Template(ushort HeaderVersion, ushort Version, List<TemplateBlock> Blocks);

    static Template ReadTemplate(string path)
    {
        var data = File.ReadAllBytes(path);
        using var reader = new BinaryReader(new MemoryStream(data));

        reader.ReadUInt32(); // file size
        var headerVersion = reader.ReadUInt16();
        var version = reader.ReadUInt16();
        var blockOffset = reader.ReadUInt32();
        var blockCount = reader.ReadUInt32();

        var blocks = new List<TemplateBlock>();
        for (var i = 0; i < blockCount; i++)
        {
            var entry = 8 + blockOffset + i * 12;
            reader.BaseStream.Position = entry;
            var type = Encoding.ASCII.GetString(reader.ReadBytes(4));
            var offset = reader.ReadUInt32();
            var size = reader.ReadUInt32();
            var start = entry + 4 + offset;
            blocks.Add(new TemplateBlock(type, data.AsSpan((int)start, (int)size).ToArray()));
        }

        return new Template(headerVersion, version, blocks);
    }

    // Same container layout the game files use: 16-byte header, a 12-byte entry
    // per block whose offset is relative to the offset field, blocks 16-aligned.
    static void WriteResource(string path, ushort headerVersion, ushort version, List<TemplateBlock> blocks)
    {
        using var ms = new MemoryStream();
        using var writer = new BinaryWriter(ms);

        writer.Write(0u);
        writer.Write(headerVersion);
        writer.Write(version);
        writer.Write(8u);
        writer.Write((uint)blocks.Count);

        var tableStart = ms.Position;
        foreach (var block in blocks)
        {
            writer.Write(Encoding.ASCII.GetBytes(block.Type));
            writer.Write(0u);
            writer.Write(0u);
        }

        for (var i = 0; i < blocks.Count; i++)
        {
            while (ms.Position % 16 != 0)
            {
                writer.Write((byte)0);
            }

            var blockStart = ms.Position;
            writer.Write(blocks[i].Bytes);
            var blockEnd = ms.Position;

            var offsetField = tableStart + i * 12 + 4;
            ms.Position = offsetField;
            writer.Write((uint)(blockStart - offsetField));
            writer.Write((uint)blocks[i].Bytes.Length);
            ms.Position = blockEnd;
        }

        ms.Position = 0;
        writer.Write((uint)ms.Length);

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllBytes(path, ms.ToArray());
    }

    // vcss_c and vts_c keep their source text in the DATA block. Styles carry a
    // CRC + image table in front of the text, scripts (vts v2+) are plain text.
    static void CompileText(string templatePath, string inPath, string outPath, bool keepRed2)
    {
        var template = ReadTemplate(templatePath);
        var text = File.ReadAllBytes(inPath);
        var isPlainScript = templatePath.EndsWith(".vts_c", StringComparison.OrdinalIgnoreCase) && template.Version >= 2;

        byte[] dataBlock;
        if (isPlainScript)
        {
            dataBlock = text;
        }
        else
        {
            using var ms = new MemoryStream();
            using var w = new BinaryWriter(ms);
            w.Write(Crc32.HashToUInt32(text));
            w.Write((ushort)0); // no image entries
            w.Write(text);
            dataBlock = ms.ToArray();
        }

        var blocks = new List<TemplateBlock>();
        foreach (var block in template.Blocks)
        {
            switch (block.Type)
            {
                case "RED2" when keepRed2: blocks.Add(block); break;
                case "DATA": blocks.Add(new TemplateBlock("DATA", dataBlock)); break;
                // SrMa (css source map) and STAT describe the template's source, drop them.
            }
        }

        WriteResource(outPath, template.HeaderVersion, template.Version, blocks);
        Console.WriteLine($"wrote {outPath} ({text.Length} bytes of source)");
    }

    static void CompileLayout(string templatePath, string inPath, string outPath)
    {
        var template = ReadTemplate(templatePath);

        var resource = new Resource();
        resource.Read(templatePath);
        var laco = (BinaryKV3)resource.GetBlockByType(BlockType.LaCo)!;
        var format = laco.Data!.Header!.Format;

        var xml = XDocument.Load(inPath, LoadOptions.SetLineInfo);

        var ast = new KVObject();
        ast.Add("m_pRoot", BuildNode(xml.Root!));
        var root = new KVObject();
        root.Add("m_AST", ast);

        using var lacoStream = new MemoryStream();
        new BinaryKV3(root, format, BlockType.LaCo) { Resource = resource }.Serialize(lacoStream);

        // DATA: crc of empty content + zero image entries, same as the game's
        // layouts that reference no images.
        var dataBlock = new byte[6];
        BitConverter.GetBytes(Crc32.HashToUInt32([])).CopyTo(dataBlock, 0);

        var blocks = new List<TemplateBlock>();
        foreach (var block in template.Blocks)
        {
            switch (block.Type)
            {
                case "RED2": blocks.Add(block); break;
                case "DATA": blocks.Add(new TemplateBlock("DATA", dataBlock)); break;
                case "LaCo": blocks.Add(new TemplateBlock("LaCo", lacoStream.ToArray())); break;
                default: blocks.Add(block); break;
            }
        }

        WriteResource(outPath, template.HeaderVersion, template.Version, blocks);
        Console.WriteLine($"wrote {outPath}");
    }

    static readonly Dictionary<string, string> ContainerTypes = new()
    {
        ["root"] = "ROOT",
        ["styles"] = "STYLES",
        ["scripts"] = "SCRIPTS",
        ["snippets"] = "SNIPPETS",
    };

    static KVObject BuildNode(XElement element)
    {
        var node = new KVObject();
        var subNodes = new List<KVObject>();
        var name = element.Name.LocalName;

        if (ContainerTypes.TryGetValue(name, out var containerType))
        {
            node.Add("eType", containerType);
        }
        else if (name == "include")
        {
            node.Add("eType", "INCLUDE");
            node.Add("child", Reference((string?)element.Attribute("src") ?? ""));
            AddSourcePosition(node, element);
            return node;
        }
        else if (name == "snippet")
        {
            node.Add("eType", "SNIPPET");
            node.Add("name", (string?)element.Attribute("name") ?? "");
        }
        else if (name == "script")
        {
            node.Add("eType", "SCRIPT_BODY");
            node.Add("name", element.Value);
            return node;
        }
        else
        {
            node.Add("eType", "PANEL");
            node.Add("name", name);

            foreach (var attribute in element.Attributes())
            {
                var attr = new KVObject();
                attr.Add("eType", "PANEL_ATTRIBUTE");
                attr.Add("name", attribute.Name.LocalName);
                attr.Add("child", AttributeValue(attribute.Value));
                subNodes.Add(attr);
            }
        }

        foreach (var child in element.Elements())
        {
            subNodes.Add(BuildNode(child));
        }

        if (subNodes.Count == 1)
        {
            node.Add("child", subNodes[0]);
        }
        else if (subNodes.Count > 1)
        {
            var array = KVObject.Array();
            foreach (var sub in subNodes)
            {
                array.Add(sub);
            }
            node.Add("vecChildren", array);
        }

        if (name == "root")
        {
            node.Add("sourceLineColumn", KVObject.Array());
        }
        else if (name != "snippet")
        {
            AddSourcePosition(node, element);
        }

        return node;
    }

    static void AddSourcePosition(KVObject node, XElement element)
    {
        var info = (IXmlLineInfo)element;
        var position = KVObject.Array();
        position.Add(info.LineNumber);
        position.Add(info.LinePosition);
        node.Add("sourceLineColumn", position);
    }

    static KVObject AttributeValue(string value)
    {
        if (value.StartsWith("s2r://", StringComparison.Ordinal) || value.StartsWith("file://", StringComparison.Ordinal))
        {
            return Reference(value);
        }

        var node = new KVObject();
        node.Add("eType", "PANEL_ATTRIBUTE_VALUE");
        node.Add("name", value);
        return node;
    }

    static KVObject Reference(string src)
    {
        var node = new KVObject();
        if (src.StartsWith("s2r://", StringComparison.Ordinal))
        {
            node.Add("eType", "REFERENCE_COMPILED");
            node.Add("name", src["s2r://".Length..]);
        }
        else
        {
            node.Add("eType", "REFERENCE_PASSTHROUGH");
            node.Add("name", src.StartsWith("file://", StringComparison.Ordinal) ? src["file://".Length..] : src);
        }
        return node;
    }

    static void PackVpk(string dir, string outPath)
    {
        using var package = new ValvePak.Package();
        foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            var relative = Path.GetRelativePath(dir, file).Replace(Path.DirectorySeparatorChar, '/');
            package.AddFile(relative, File.ReadAllBytes(file));
            Console.WriteLine($"  + {relative}");
        }
        package.Write(outPath);
        Console.WriteLine($"wrote {outPath}");
    }

    static void PrintBlock(string path, string blockName)
    {
        var resource = new Resource();
        resource.Read(path);
        var type = Enum.Parse<BlockType>(blockName);
        var block = resource.GetBlockByType(type)!;
        using var writer = new IndentedTextWriter();
        block.WriteText(writer);
        Console.WriteLine(writer.ToString());
    }
}
