{
  description = "bang-lang — Bang language compiler (TS → Effect). Self-contained dev shell.";

  # Self-contained: this flake pins its OWN nixpkgs rather than following the
  # (private) homelab `lab` flake. Rationale: the repo must build anywhere nix
  # runs — CI, another machine, a collaborator — with no private-repo auth,
  # and own its toolchain lock independently. The homelab fragment/profile
  # system stays for the phibkro.org app fleet where DRY earns its keep.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        # node 24 (matches engines), pnpm 10.x (matches the packageManager pin
        # within a minor), bubblewrap for the dev-sandbox wrapper, and bash —
        # native postinstall scripts spawn `sh` for platform probes, so a
        # bare `sh` must be on PATH (the gotcha homelab's nodejs fragment
        # documents).
        packages = with pkgs; [
          nodejs_24
          pnpm
          bubblewrap
          bash
        ];

        shellHook = ''
          export PATH="$PWD/scripts:$PATH"
          echo "[bang-lang] node $(node --version) · pnpm $(pnpm --version) · bwrap $(bwrap --version | cut -d' ' -f2)"
          echo "  supply-chain isolation: run untrusted dev commands through the sandbox —"
          echo "    dev-sandbox.sh pnpm install        (network on, for install)"
          echo "    dev-sandbox.sh --no-net pnpm test  (network off, stronger)"
        '';
      };
    };
}
