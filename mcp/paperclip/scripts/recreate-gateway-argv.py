#!/usr/bin/env python3
"""Fail closed before Docker recreate if a live gateway cannot be cloned safely."""
import json, os, sys
from pathlib import Path
def fail(m): raise SystemExit("REFUSED: " + m)
def load(p):
    d=json.loads(Path(p).read_text())
    if not isinstance(d,list) or len(d)!=1: fail("expected exactly one inspect record")
    return d[0]
def signature(d):
    c=d.get("Config") or {}; h=d.get("HostConfig") or {}
    return {
      "env":sorted(c.get("Env") or []), "entrypoint":c.get("Entrypoint"),
      "cmd":c.get("Cmd"), "user":c.get("User") or "", "cwd":c.get("WorkingDir") or "",
      "network":h.get("NetworkMode"), "restart":(h.get("RestartPolicy") or {}).get("Name"),
      "mounts":sorted((m.get("Type"),m.get("Name") or "",m.get("Source") or "",
        m.get("Destination"),bool(m.get("RW"))) for m in d.get("Mounts") or [])
    }
def prepare(src,name,backup,argpath,envpath):
    d=load(src); c=d.get("Config") or {}; h=d.get("HostConfig") or {}
    nets=d.get("NetworkSettings",{}).get("Networks") or {}
    if d.get("Name")!="/"+name or d.get("State",{}).get("Running") is not True:
        fail("source name or running state differs")
    if h.get("NetworkMode")!="paperclip-net" or set(nets)!={"paperclip-net"}:
        fail("unexpected network")
    if h.get("Privileged") or h.get("AutoRemove") or h.get("PublishAllPorts"):
        fail("privileged/auto-remove/auto-published service")
    for key in ("CapAdd","CapDrop","Devices","DeviceRequests","Links","ExtraHosts","Dns",
                "DnsOptions","DnsSearch","SecurityOpt","Ulimits","VolumesFrom","PortBindings",
                "CpuQuota","CpuPeriod","CpuShares","NanoCpus","CpusetCpus","Memory",
                "MemorySwap","CgroupParent","OomKillDisable"):
        if h.get(key): fail("unsupported HostConfig."+key)
    if h.get("ReadonlyRootfs") or h.get("UsernsMode") not in (None,"","private"):
        fail("unsupported root/user namespace")
    restart=(h.get("RestartPolicy") or {}).get("Name")
    if restart not in ("always","unless-stopped"): fail("unsupported restart policy")
    env=c.get("Env")
    if not isinstance(env,list) or not env or any(
        not isinstance(e,str) or "=" not in e or "\n" in e or "\r" in e for e in env):
        fail("environment cannot be represented in an env file")
    mounts=d.get("Mounts") or []
    if not any(x.get("Destination")=="/paperclip" and x.get("Type")=="volume"
         and x.get("Name")=="paperclip-home" and x.get("RW") is True for x in mounts):
        fail("persistent paperclip-home volume not present")
    if any(x.get("Type") not in ("volume","bind") for x in mounts):
        fail("unknown mount type")
    entry=c.get("Entrypoint")
    if not isinstance(entry,list) or len(entry)!=1 or not entry[0].startswith("/"):
        fail("entrypoint not representable as one absolute executable")
    cmd=c.get("Cmd")
    if cmd is not None and (not isinstance(cmd,list) or
                            not all(isinstance(x,str) for x in cmd)):
        fail("invalid command")
    labels=c.get("Labels") or {}
    if any(x.startswith("com.docker.compose.") for x in labels):
        fail("Compose-managed gateway requires native Compose release")
    aliases=nets["paperclip-net"].get("Aliases") or []
    aliases=sorted(set(a for a in aliases if isinstance(a,str) and
                       a not in (name,d.get("Id","")[:12])))
    argv=["--name",name,"--network","paperclip-net","--restart",restart,
          "--volumes-from",backup,"--entrypoint",entry[0]]
    for alias in aliases: argv+=["--network-alias",alias]
    if c.get("User"): argv+=["--user",c["User"]]
    if c.get("WorkingDir"): argv+=["--workdir",c["WorkingDir"]]
    for k,v in sorted(labels.items()):
        if k!="org.opencontainers.image.revision": argv+=["--label",k+"="+v]
    argv+=["--env-file",envpath]
    Path(envpath).write_text("\n".join(env)+"\n"); os.chmod(envpath,0o600)
    Path(argpath).write_bytes(b"\0".join(x.encode() for x in argv)+b"\0")
    print("SPEC_VERIFIED",len(env),"env entries,",len(mounts),"mounts")
if __name__=="__main__":
    if len(sys.argv)!=7: fail("invalid arguments")
    mode,a,b,c,d,e=sys.argv[1:]
    if mode=="prepare": prepare(a,b,c,d,e)
    elif mode=="verify":
        if signature(load(a))!=signature(load(b)): fail("network/env/mounts/entrypoint/cmd/user/cwd/restart changed")
        print("CONFIG_MATCH")
    else: fail("unknown mode")
