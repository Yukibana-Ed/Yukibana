{
  description = "Yukibana Cloud development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # pnpm, which installs and runs the workspace: it switches itself to the root's packageManager release and runs
        # every script on the exact Node.js release of the root's devEngines, which it downloads. That download is a
        # generic Linux binary, so on NixOS it needs nix-ld (programs.nix-ld.enable). Node 24 is for pnpm itself.
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm
          ];
        };
      });
    };
}
