namespace Umbraco.WebMCP;

/// <summary>
/// Options for Umbraco WebMCP, bound from the <c>Umbraco:WebMCP</c> configuration section.
/// </summary>
public class WebMcpOptions
{
    /// <summary>
    /// The configuration section the options are bound from.
    /// </summary>
    public const string SectionName = "Umbraco:WebMCP";

    /// <summary>
    /// Whether the backoffice registers WebMCP tools. When unset, tools are only registered in the Development environment.
    /// </summary>
    public bool? Enabled { get; set; }
}
