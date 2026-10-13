using System.Reflection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Manifest;
using Umbraco.Cms.Infrastructure.Manifest;

namespace Umbraco.Community.WebMCP;

/// <summary>
/// Supplies the backoffice entry points: the tools, plus one entry point per enabled surface (WebMCP).
/// When no surface is enabled, nothing is supplied, so the tools never load in environments that didn't opt in.
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
        WebMcpOptions options = _options.Value;
        var defaultEnabled = options.Enabled ?? _hostEnvironment.IsDevelopment();

        // Each surface is its own entry point, so a surface that isn't enabled is never loaded in the browser.
        List<object> surfaces = [];
        if (options.ModelContext ?? defaultEnabled)
        {
            surfaces.Add(EntryPoint("ModelContext", "WebMCP Model Context Entry Point", "umbraco-community-webmcp-model-context.js"));
        }

        if (surfaces.Count == 0)
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
            // The tools themselves first, then the surfaces that make them reachable.
            Extensions = [EntryPoint("EntryPoint", "WebMCP Entry Point", "umbraco-community-webmcp.js"), .. surfaces],
        };

        return Task.FromResult<IEnumerable<PackageManifest>>([manifest]);
    }

    private static object EntryPoint(string aliasSuffix, string name, string fileName) => new
    {
        type = "backofficeEntryPoint",
        alias = $"{Constants.PackageId}.{aliasSuffix}",
        name,
        js = $"/App_Plugins/{Constants.PackageId}/{fileName}",
    };
}
