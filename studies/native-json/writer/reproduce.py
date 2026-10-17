"""Serialize controlled data using pinned upstream types and Newtonsoft.Json 13.0.3.

Requires .NET 10 SDK. python3 reproduce.py [--dotnet /path/to/dotnet]
All fetched source, restore and build files stay in ../cache/writer/.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request

HERE = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dotnet", default="dotnet")
    args = parser.parse_args()
    manifest = json.loads((HERE / "source-manifest.json").read_text())
    cache = HERE.parent / "cache" / "writer"
    cache.mkdir(parents=True, exist_ok=True)
    for record in manifest["files"]:
        path = record["path"]
        url = f'https://raw.githubusercontent.com/{manifest["repository"]}/{manifest["commit"]}/{path}'
        target = cache / "Upstream" / path
        if target.exists():
            data = target.read_bytes()
        else:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read()
        assert len(data) == record["bytes"] and hashlib.sha256(data).hexdigest() == record["sha256"], path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    with urllib.request.urlopen(f'https://raw.githubusercontent.com/{manifest["repository"]}/{manifest["commit"]}/LICENSE', timeout=60) as response:
        (cache / "Upstream" / "LICENSE").write_bytes(response.read())
    shutil.copyfile(HERE / "Program.cs", cache / "Program.cs")
    project = cache / "writer.csproj"
    project.write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /></ItemGroup></Project>')
    env = dict(os.environ, DOTNET_CLI_HOME=str(cache / "cli"), NUGET_PACKAGES=str(cache / "nuget"), DOTNET_CLI_TELEMETRY_OPTOUT="1", DOTNET_NOLOGO="1")
    sdk = subprocess.check_output([args.dotnet, "--version"], env=env, text=True).strip()
    output = cache / "session.json"
    run = subprocess.run([args.dotnet, "run", "--project", str(project), "--configuration", "Release", "--", str(output)], env=env, capture_output=True, text=True, timeout=180)
    (cache / "build.log").write_text(run.stdout + run.stderr)
    run.check_returncode()
    raw = output.read_bytes()
    retained = HERE.parents[2] / "tests" / "fixtures" / "capframex-json" / "native-writer.json"
    assert raw == retained.read_bytes(), "native serializer output differs from the retained fixture"
    receipt = {"upstreamCommit": manifest["commit"], "sourceFiles": len(manifest["files"]), "sdk": sdk,
               "newtonsoftJson": manifest["newtonsoftJson"], "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
               "byteIdenticalToRetainedFixture": True, "inputKind": "controlled synthetic data serialized by upstream classes; no Windows client or game recording"}
    target = HERE.parent / "results" / "writer.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))

if __name__ == "__main__":
    main()
