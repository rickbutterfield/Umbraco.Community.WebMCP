using System.Reflection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Manifest;
using Umbraco.Cms.Infrastructure.Manifest;

namespace Umbraco.WebMCP;

/// <summary>
/// Supplies the backoffice entry point only when WebMCP is enabled, so the tools never load in environments that didn't opt in.
/// </summary>
internal sealed class WebMcpPackageManifestReader : IPackageManifestReader
{
    private readonly IHostEnvironment _hostEnvironment;
    private readonly IOptions<WebMcpOptions> _options;

    public WebMcpPackageManifestReader(IHostEnvironment hostEnvironment, IOptions<WebMcpOptions> options)
    {
        _hostEnvironment = hostEnvironment;
        _options = options;
    }

    public Task<IEnumerable<PackageManifest>> ReadPackageManifestsAsync()
    {
        var enabled = _options.Value.Enabled ?? _hostEnvironment.IsDevelopment();
        if (enabled is false)
        {
            return Task.FromResult(Enumerable.Empty<PackageManifest>());
        }

        PackageManifest manifest = new()
        {
            Id = Constants.PackageId,
            Name = Constants.PackageId,
            // The CMS derives the cache-busting hash for the entry point URL from the version, as the stamped
            // umbraco-package.json version does in the Umbraco DXP products.
            Version = typeof(WebMcpPackageManifestReader).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            AllowTelemetry = false,
            Extensions =
            [
                new
                {
                    type = "backofficeEntryPoint",
                    alias = $"{Constants.PackageId}.EntryPoint",
                    name = "WebMCP Entry Point",
                    js = $"/App_Plugins/{Constants.PackageId}/umbraco-webmcp.js",
                },
            ],
        };

        return Task.FromResult<IEnumerable<PackageManifest>>([manifest]);
    }
}
