using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Infrastructure.Manifest;

namespace Umbraco.Community.WebMCP;

/// <summary>
/// Registers the WebMCP options and the manifest reader that serves the backoffice entry point when enabled.
/// </summary>
public class WebMcpComposer : IComposer
{
    /// <inheritdoc />
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.Configure<WebMcpOptions>(builder.Config.GetSection(WebMcpOptions.SectionName));
        builder.Services.AddSingleton<IPackageManifestReader, WebMcpPackageManifestReader>();
    }
}
