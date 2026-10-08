namespace Umbraco.WebMCP;

/// <summary>
/// Options for Umbraco WebMCP, bound from the <c>Umbraco:WebMCP</c> configuration section.
/// </summary>
/// <remarks>
/// Each surface the tools are reachable through has its own setting, so enabling one never enables another. A surface
/// left unset follows <see cref="Enabled"/>, and that defaults to the Development environment only.
/// </remarks>
public class WebMcpOptions
{
    /// <summary>
    /// The configuration section the options are bound from.
    /// </summary>
    public const string SectionName = "Umbraco:WebMCP";

    /// <summary>
    /// The default for every surface. When unset, the surfaces are only enabled in the Development environment.
    /// </summary>
    public bool? Enabled { get; set; }

    /// <summary>
    /// Whether the tools are registered with WebMCP (<c>document.modelContext</c>) for in-browser agents. When unset,
    /// follows <see cref="Enabled"/>.
    /// </summary>
    public bool? ModelContext { get; set; }

    /// <summary>
    /// Whether the tools are exposed to page scripts as <c>window.__umbWebMcp</c>, for Playwright and similar. When
    /// unset, follows <see cref="Enabled"/>.
    /// </summary>
    public bool? PageApi { get; set; }
}
