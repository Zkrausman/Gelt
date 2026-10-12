// Windows PowerShell 5.1 / .NET Framework 4.8, Windows 11 or Server 2022, local NTFS.
// Same-user, Administrators, SYSTEM and Windows servicing compromise are excluded.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
namespace Gelt {
 public static class PrivateStorage {
  const uint READ_CONTROL=0x20000, ATTR=0x80, GENERIC_READ=0x80000000, GENERIC_WRITE=0x40000000;
  const uint DIR=0x02000000, REPARSE=0x00200000, WRITE_THROUGH=0x80000000;
  const string SystemSid="S-1-5-18", AdminSid="S-1-5-32-544", InstallerSid="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
  static readonly string User=WindowsIdentity.GetCurrent().User.Value;
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME created, accessed, written; public uint serial,sizeHigh,sizeLow,links,indexHigh,indexLow; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string p,uint access,uint share,IntPtr sa,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] static extern SafeFileHandle CreateNew(string p,uint access,uint share,ref SA sa,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectory(string p,ref SA sa);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder p,uint size,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle h,StringBuilder name,uint n,out uint serial,out uint max,out uint flags,StringBuilder fs,uint f);
  [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle h,int kind,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool MoveFileEx(string from,string to,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool DeleteFile(string p);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetDriveType(string root);
  // Per invocation only; never retain exception text or OS-provided values.
  enum CheckCode { REQUEST, PATH, OPEN, CREATE, METADATA, TYPE, REPARSE, LINKS, SIZE, CANONICAL, FILESYSTEM, SECURITY, OWNER, DACL, ACCESS, READ, WRITE, FLUSH, MOVE, DELETE, DPAPI, INTERNAL }
  enum ObjectKind { none, parent, main, wal, shm, journal }
  [ThreadStatic] static CheckCode check;
  [ThreadStatic] static ObjectKind kind;
  static void Check(bool ok, CheckCode code) { check=code; if(!ok) throw new InvalidOperationException("secure storage unavailable"); }
  static void At(CheckCode code) { check=code; }
  static bool Trusted(string sid) { return sid==User || sid==SystemSid || sid==AdminSid || sid==InstallerSid; }
  // SQLite-created sidecars can inherit a trusted token default owner on Server
  // 2022. Never enable this exception for an unclassified file or main/secrets.
  // Unknown kinds fail closed even if the supplied owner is the current user.
  static bool PrivateOwner(string owner,bool sqlite,ObjectKind objectKind) {
   if(!Enum.IsDefined(typeof(ObjectKind),objectKind)) return false;
   return owner==User || (sqlite && (objectKind==ObjectKind.wal || objectKind==ObjectKind.shm || objectKind==ObjectKind.journal) && Trusted(owner));
  }
  // Called only after PathCheck. Inspect the final canonical filename, case
  // sensitively, so generic -wal names and directory-component matches cannot
  // acquire SQLite sidecar ownership semantics.
  static ObjectKind SQLiteFileKind(string path) {
   string name=Path.GetFileName(path);
   if(name.EndsWith(".sqlite-wal",StringComparison.Ordinal)) return ObjectKind.wal;
   if(name.EndsWith(".sqlite-shm",StringComparison.Ordinal)) return ObjectKind.shm;
   if(name.EndsWith(".sqlite-journal",StringComparison.Ordinal)) return ObjectKind.journal;
   if(name.EndsWith(".sqlite",StringComparison.Ordinal)) return ObjectKind.main;
   Check(false,CheckCode.PATH); return ObjectKind.none;
  }
  static void PathCheck(string p) {
   Check(p!=null && p.Length>=4 && p.Length<=220 && p[1]==':' && p[2]=='\\' && char.IsLetter(p[0]), CheckCode.PATH);
   Check(GetDriveType(p.Substring(0,3))==3, CheckCode.FILESYSTEM);
   At(CheckCode.PATH); Check(p.IndexOf(':',2)<0 && p.IndexOf('/')<0 && !p.Contains("\\\\") && Path.GetFullPath(p)==p, CheckCode.PATH);
   foreach(string part in p.Substring(3).Split('\\')) {
    Check(part.Length>0 && part!="." && part!=".." && !part.EndsWith(".") && !part.EndsWith(" "), CheckCode.PATH);
    Check(part.IndexOfAny(Path.GetInvalidFileNameChars())<0, CheckCode.PATH);
    string stem=part.Split('.')[0].ToUpperInvariant();
    Check(stem!="CON" && stem!="PRN" && stem!="AUX" && stem!="NUL" && !System.Text.RegularExpressions.Regex.IsMatch(stem,"^(COM|LPT)[0-9]+$"), CheckCode.PATH);
   }
  }
  static SafeFileHandle Open(string p,uint access,uint share) {
   At(CheckCode.OPEN); var h=CreateFile(p,access|READ_CONTROL|ATTR,share,IntPtr.Zero,3,DIR|REPARSE,IntPtr.Zero);
   if(h.IsInvalid) { int e=Marshal.GetLastWin32Error(); h.Dispose(); if(e==2) throw new FileNotFoundException(); throw new InvalidOperationException(); } return h;
  }
  static void Validate(SafeFileHandle h,string p,bool directory,bool privateObject,bool sqlite=false) {
   At(CheckCode.METADATA); Info i; Check(GetFileInformationByHandle(h,out i), CheckCode.METADATA); Check((i.attributes&0x400)==0, CheckCode.REPARSE); Check(((i.attributes&16)!=0)==directory, CheckCode.TYPE);
   if(!directory) { Check(i.links==1, CheckCode.LINKS); Check(sqlite || i.sizeHigh==0 && i.sizeLow<=150000, CheckCode.SIZE); }
   At(CheckCode.CANONICAL); var name=new StringBuilder(512); uint n=GetFinalPathNameByHandle(h,name,512,0);
   Check(n>0 && n<512 && String.Equals(name.ToString(),"\\\\?\\"+p,StringComparison.OrdinalIgnoreCase), CheckCode.CANONICAL);
   At(CheckCode.FILESYSTEM); uint serial,max,flags; var fs=new StringBuilder(32);
   Check(GetVolumeInformationByHandleW(h,null,0,out serial,out max,out flags,fs,32) && fs.ToString()=="NTFS", CheckCode.FILESYSTEM);
   At(CheckCode.SECURITY); IntPtr owner,group,dacl,sacl,sd; Check(GetSecurityInfo(h,1,7,out owner,out group,out dacl,out sacl,out sd)==0, CheckCode.SECURITY);
   try {
    At(CheckCode.SECURITY); byte[] raw=new byte[GetSecurityDescriptorLength(sd)]; Marshal.Copy(sd,raw,0,raw.Length);
    var descriptor=new RawSecurityDescriptor(raw,0);
    Check(descriptor.Owner!=null && (privateObject ? PrivateOwner(descriptor.Owner.Value,sqlite,kind) : Trusted(descriptor.Owner.Value)), CheckCode.OWNER);
    Check(descriptor.DiscretionaryAcl!=null, CheckCode.DACL);
    if(privateObject && !sqlite) Check((descriptor.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0, CheckCode.DACL);
    bool userAllowed=false;
    foreach(GenericAce ace in descriptor.DiscretionaryAcl) {
     var common=ace as CommonAce; Check(common!=null && !common.IsCallback, CheckCode.DACL);
     if(privateObject) { if(!sqlite) Check((common.AceFlags&AceFlags.Inherited)==0, CheckCode.DACL); Check(common.AceQualifier!=AceQualifier.AccessAllowed || Trusted(common.SecurityIdentifier.Value), CheckCode.DACL); }
     if((common.AceFlags&AceFlags.InheritOnly)!=0) continue;
     Check(common.AceQualifier==AceQualifier.AccessAllowed || common.AceQualifier==AceQualifier.AccessDenied, CheckCode.DACL);
     if(common.AceQualifier!=AceQualifier.AccessAllowed) continue;
     string sid=common.SecurityIdentifier.Value;
     if(sid==User && (common.AccessMask&0x1f01ff)==0x1f01ff) userAllowed=true;
     // Ancestors may allow traversal/read and creation, but not replacement/deletion
     // of existing protected children, or changing their own security/identity.
     int unsafeAncestor=0x10000|0x40000|0x80000|0x40|0x100|0x10|unchecked((int)0x10000000)|0x40000000;
     Check(Trusted(sid) || (!privateObject && (common.AccessMask&unsafeAncestor)==0), CheckCode.ACCESS);
    }
    if(privateObject) Check(userAllowed, CheckCode.ACCESS);
   } finally { LocalFree(sd); }
  }
  // Hold every ancestor without FILE_SHARE_DELETE until the operation completes.
  static List<SafeFileHandle> Parents(string path,bool includeLeaf) {
   var list=new List<SafeFileHandle>();
   try {
    string p=includeLeaf?path:Path.GetDirectoryName(path);
    var names=new List<string>(); while(p!=null) { names.Add(p); p=Path.GetDirectoryName(p); }
    names.Reverse();
    foreach(string name in names) { var h=Open(name,0,3); list.Add(h); Validate(h,name,true,includeLeaf && name==path || !includeLeaf && name==Path.GetDirectoryName(path)); }
    return list;
   } catch { foreach(var h in list) h.Dispose(); throw; }
  }
  // SQLite itself creates sidecars: require the exact owner-only inheritable
  // directory descriptor BEFORE SQLite opens/creates anything, not ACL repair later.
  static void SQLiteParent(string path) {
   string parent=Path.GetDirectoryName(path);
   using(var h=Open(parent,0,3)) {
    Validate(h,parent,true,true);
    At(CheckCode.SECURITY); IntPtr owner,group,dacl,sacl,sd; Check(GetSecurityInfo(h,1,7,out owner,out group,out dacl,out sacl,out sd)==0, CheckCode.SECURITY);
    try {
     At(CheckCode.SECURITY); byte[] raw=new byte[GetSecurityDescriptorLength(sd)]; Marshal.Copy(sd,raw,0,raw.Length);
     var descriptor=new RawSecurityDescriptor(raw,0); Check(descriptor.DiscretionaryAcl.Count==1, CheckCode.DACL);
     var ace=descriptor.DiscretionaryAcl[0] as CommonAce;
     Check(ace!=null && !ace.IsCallback && ace.AceQualifier==AceQualifier.AccessAllowed && ace.SecurityIdentifier.Value==User && ace.AccessMask==0x1f01ff && (int)ace.AceFlags==3, CheckCode.DACL);
    } finally { LocalFree(sd); }
   }
  }
  static SA Security(out IntPtr memory,bool inheritable=false) {
   At(CheckCode.SECURITY); var sd=new RawSecurityDescriptor("O:"+User+"G:"+User+"D:P(A;"+(inheritable?"OICI":"")+";FA;;;"+User+")");
   var bytes=new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes,0); memory=Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes,0,memory,bytes.Length);
   return new SA { length=Marshal.SizeOf(typeof(SA)), descriptor=memory, inherit=0 };
  }
  static void NewFile(string path,byte[] data) {
   IntPtr memory; var sa=Security(out memory);
   try {
    At(CheckCode.CREATE); using(var h=CreateNew(path,GENERIC_READ|GENERIC_WRITE|READ_CONTROL,0,ref sa,1,WRITE_THROUGH|REPARSE,IntPtr.Zero)) {
     Check(!h.IsInvalid, CheckCode.CREATE); Validate(h,path,false,true);
     At(CheckCode.WRITE); using(var stream=new FileStream(h,FileAccess.ReadWrite)) { At(CheckCode.WRITE); stream.Write(data,0,data.Length); At(CheckCode.FLUSH); stream.Flush(true); }
    }
   } finally { Marshal.FreeHGlobal(memory); }
  }
  static byte[] Read(string path,int max) {
   using(var h=Open(path,GENERIC_READ,1)) {
    Validate(h,path,false,true);
    At(CheckCode.READ); using(var stream=new FileStream(h,FileAccess.Read)) { Check(stream.Length<=max, CheckCode.SIZE); byte[] data=new byte[stream.Length]; int n=0; while(n<data.Length) { At(CheckCode.READ); int count=stream.Read(data,n,data.Length-n); Check(count>0, CheckCode.READ); n+=count; } return data; }
   }
  }
  static void Replace(string path,byte[] data) {
   try { Read(path,150000); } catch(FileNotFoundException) { }
   string temp=path+"."+Guid.NewGuid().ToString("N");
   // Both paths are under retained private parent handles. Same-user substitution
   // is outside the boundary. Never repair a descriptor on a public object.
   NewFile(temp,data);
   // MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH, same-volume NTFS only.
   // A failed rename leaves evidence; caller must retain its persistent lock.
   At(CheckCode.MOVE); Check(MoveFileEx(temp,path,1|8), CheckCode.MOVE);
   Read(path,150000);
  }
  public static string Run(string op,string path,string data,int max) {
   check=CheckCode.INTERNAL; kind=ObjectKind.none;
   try { return Execute(op,path,data,max); }
   catch { return "FAIL:OPERATION:"+check.ToString()+(kind==ObjectKind.none?"":":"+kind.ToString()); }
  }
  static string Execute(string op,string path,string data,int max) {
   At(CheckCode.REQUEST);
   Check(Environment.OSVersion.Version.Major>=10 && Environment.OSVersion.Version.Build>=20348 && max>=0 && max<=150000 && data.Length<=200000, CheckCode.REQUEST);
   Check(op=="sqlite-set" || op=="sqlite-file" || op=="sqlite-mkdir" || op=="directory" || op=="mkdir" || op=="read" || op=="new" || op=="replace" || op=="remove" || op=="protect" || op=="unprotect", CheckCode.REQUEST);
   if(op=="protect" || op=="unprotect") {
    Check(path=="" && max==0, CheckCode.REQUEST); byte[] bytes=Convert.FromBase64String(data);
    byte[] entropy=Encoding.UTF8.GetBytes("Gelt/M3/DPAPI/v1");
    At(CheckCode.DPAPI); if(op=="protect") { Check(bytes.Length==32, CheckCode.DPAPI); return "OK:"+Convert.ToBase64String(ProtectedData.Protect(bytes,entropy,DataProtectionScope.CurrentUser)); }
    Check(bytes.Length>32 && bytes.Length<8192, CheckCode.DPAPI); var key=ProtectedData.Unprotect(bytes,entropy,DataProtectionScope.CurrentUser); Check(key.Length==32, CheckCode.DPAPI); return "OK:"+Convert.ToBase64String(key);
   }
   At(CheckCode.PATH); PathCheck(path);
   ObjectKind sqliteFileKind=ObjectKind.none;
   if(op=="sqlite-file") sqliteFileKind=SQLiteFileKind(path);
   // mkdir's immediate parent is an ancestor, not an existing application directory.
   List<SafeFileHandle> parents=null;
   try {
    if(op=="mkdir" || op=="sqlite-mkdir") {
     kind=ObjectKind.parent; parents=ParentsForCreation(path); kind=ObjectKind.none; IntPtr memory; var sa=Security(out memory,op=="sqlite-mkdir");
     try { At(CheckCode.CREATE); Check(CreateDirectory(path,ref sa), CheckCode.CREATE); } finally { Marshal.FreeHGlobal(memory); }
     using(var h=Open(path,0,3)) Validate(h,path,true,true);
    } else {
     kind=ObjectKind.parent; parents=Parents(path,op=="directory"); kind=ObjectKind.none;
     if(op=="read") { try { return "OK:"+Convert.ToBase64String(Read(path,max)); } catch(FileNotFoundException) { return "MISSING"; } }
     if(op=="sqlite-set") {
      kind=ObjectKind.parent; SQLiteParent(path);
      foreach(string suffix in new string[] { "", "-wal", "-shm", "-journal" }) {
       kind=suffix==""?ObjectKind.main:suffix=="-wal"?ObjectKind.wal:suffix=="-shm"?ObjectKind.shm:ObjectKind.journal;
       At(CheckCode.PATH); string file=path+suffix; PathCheck(file);
       try { using(var h=Open(file,0,7)) Validate(h,file,false,true,true); } catch(FileNotFoundException) { }
      }
     }
     if(op=="sqlite-file") { kind=sqliteFileKind; using(var h=Open(path,0,7)) Validate(h,path,false,true,true); }
     if(op=="new") NewFile(path,Convert.FromBase64String(data));
     if(op=="replace") Replace(path,Convert.FromBase64String(data));
     if(op=="remove") { Read(path,150000); At(CheckCode.DELETE); Check(DeleteFile(path), CheckCode.DELETE); }
    }
    return "OK:";
   } finally { if(parents!=null) foreach(var h in parents) h.Dispose(); }
  }
  static List<SafeFileHandle> ParentsForCreation(string path) {
   var handles=new List<SafeFileHandle>();
   try {
    var names=new List<string>(); string p=Path.GetDirectoryName(path); while(p!=null) { names.Add(p); p=Path.GetDirectoryName(p); } names.Reverse();
    foreach(var name in names) { var h=Open(name,0,3); handles.Add(h); Validate(h,name,true,false); }
    return handles;
   } catch { foreach(var h in handles) h.Dispose(); throw; }
  }
 }
}
