package tools

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"math"
	"strings"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

const (
	chartWidth  = 800
	chartHeight = 600
)

type chartDatum struct {
	Value float64
	Label string
}

// ErrChartWriterUnavailable is returned when no outer chart writer is installed.
var ErrChartWriterUnavailable = errors.New("chart writer unavailable")

// ChartWriteFailureKind identifies the concrete persistence step that failed.
type ChartWriteFailureKind string

const (
	ChartWriteFailureDirectory ChartWriteFailureKind = "directory"
	ChartWriteFailureFile      ChartWriteFailureKind = "file"
)

// ChartWriteError lets the outer writer preserve core-owned tool error wording.
type ChartWriteError struct {
	Kind ChartWriteFailureKind
	Err  error
}

func (e ChartWriteError) Error() string {
	if e.Err == nil {
		return string(e.Kind)
	}
	return e.Err.Error()
}

func (e ChartWriteError) Unwrap() error {
	return e.Err
}

// ChartWriteRequest is the generated chart payload delegated to an outer writer.
type ChartWriteRequest struct {
	Path    string
	Content []byte
}

// ChartWriter persists generated chart bytes outside the core package.
type ChartWriter interface {
	WriteChart(context.Context, ChartWriteRequest) error
}

type emptyChartWriter struct{}

func (emptyChartWriter) WriteChart(context.Context, ChartWriteRequest) error {
	return ErrChartWriterUnavailable
}

var chartWriters = runtimevalue.New[ChartWriter](emptyChartWriter{})

// SetChartWriter installs the outer writer used by create_chart and returns a restore function.
func SetChartWriter(writer ChartWriter) func() {
	return chartWriters.Set(writer)
}

func currentChartWriter() ChartWriter {
	return chartWriters.Current()
}

func toolCreateChart(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	filePath := getString(args, "filePath")
	if filePath == "" {
		return invalidArgs("create_chart", args, "missing filePath")
	}

	chartType := getString(args, "type") // "bar" or "pie"
	title := getString(args, "title")
	data, ok := args["data"].([]any)
	if !ok || len(data) == 0 {
		return invalidArgs("create_chart", args, "missing or empty data")
	}

	full, ok := prepareExternalFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	isSVG := strings.HasSuffix(strings.ToLower(filePath), ".svg")

	var values []chartDatum
	for _, item := range data {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		label := getString(m, "label")
		val := toFloat(m["value"])
		values = append(values, chartDatum{Value: val, Label: label})
	}

	var content bytes.Buffer
	if err := renderChart(chartType, title, values, isSVG, &content); err != nil {
		state.Status = "error"
		state.Error = "Error rendering chart: " + err.Error()
		return state
	}
	if err := currentChartWriter().WriteChart(ctx.Ctx, ChartWriteRequest{Path: full, Content: append([]byte(nil), content.Bytes()...)}); err != nil {
		state.Status = "error"
		state.Error = chartWriteErrorMessage(err)
		return state
	}

	state.Output = fmt.Sprintf("Chart created successfully at %s", filePath)
	state.Title = filePath
	state.TitleSet = true
	return state
}

func renderChart(chartType, title string, values []chartDatum, isSVG bool, w io.Writer) error {
	if len(values) == 0 {
		return fmt.Errorf("missing chart values")
	}
	if isSVG {
		return renderChartSVG(chartType, title, values, w)
	}
	return renderChartPNG(chartType, values, w)
}

func renderChartSVG(chartType, title string, values []chartDatum, w io.Writer) error {
	fmt.Fprintf(w, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`, chartWidth, chartHeight, chartWidth, chartHeight)
	fmt.Fprint(w, `<rect width="100%" height="100%" fill="#ffffff"/>`)
	if title != "" {
		fmt.Fprintf(w, `<text x="%d" y="42" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#111827">%s</text>`, chartWidth/2, html.EscapeString(title))
	}
	if chartType == "pie" {
		renderPieSVG(values, w)
	} else {
		renderBarSVG(values, w)
	}
	fmt.Fprint(w, `</svg>`)
	return nil
}

func renderBarSVG(values []chartDatum, w io.Writer) {
	maxValue := maxChartValue(values)
	left, top, right, bottom := 80.0, 80.0, 760.0, 520.0
	plotWidth := right - left
	plotHeight := bottom - top
	barGap := 12.0
	barWidth := math.Max(8, (plotWidth-float64(len(values)+1)*barGap)/float64(len(values)))
	fmt.Fprintf(w, `<line x1="%.0f" y1="%.0f" x2="%.0f" y2="%.0f" stroke="#111827" stroke-width="2"/>`, left, bottom, right, bottom)
	for i, item := range values {
		height := (item.Value / maxValue) * plotHeight
		x := left + barGap + float64(i)*(barWidth+barGap)
		y := bottom - height
		fill := chartPalette[i%len(chartPalette)]
		fmt.Fprintf(w, `<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="4" fill="%s"/>`, x, y, barWidth, height, fill.hex)
		fmt.Fprintf(w, `<text x="%.2f" y="%.2f" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#374151">%s</text>`, x+barWidth/2, bottom+24, html.EscapeString(item.Label))
	}
}

func renderPieSVG(values []chartDatum, w io.Writer) {
	total := sumChartValues(values)
	cx, cy, radius := 400.0, 305.0, 190.0
	start := -math.Pi / 2
	for i, item := range values {
		angle := (item.Value / total) * 2 * math.Pi
		end := start + angle
		largeArc := 0
		if angle > math.Pi {
			largeArc = 1
		}
		x1, y1 := cx+radius*math.Cos(start), cy+radius*math.Sin(start)
		x2, y2 := cx+radius*math.Cos(end), cy+radius*math.Sin(end)
		fill := chartPalette[i%len(chartPalette)]
		fmt.Fprintf(w, `<path d="M %.2f %.2f L %.2f %.2f A %.2f %.2f 0 %d 1 %.2f %.2f Z" fill="%s"/>`, cx, cy, x1, y1, radius, radius, largeArc, x2, y2, fill.hex)
		start = end
	}
}

func renderChartPNG(chartType string, values []chartDatum, w io.Writer) error {
	img := image.NewRGBA(image.Rect(0, 0, chartWidth, chartHeight))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	if chartType == "pie" {
		renderPiePNG(img, values)
	} else {
		renderBarPNG(img, values)
	}
	return png.Encode(w, img)
}

func renderBarPNG(img *image.RGBA, values []chartDatum) {
	maxValue := maxChartValue(values)
	left, top, right, bottom := 80, 80, 760, 520
	drawRect(img, left, bottom, right-left, 2, color.RGBA{17, 24, 39, 255})
	plotWidth := float64(right - left)
	plotHeight := float64(bottom - top)
	barGap := 12.0
	barWidth := int(math.Max(8, (plotWidth-float64(len(values)+1)*barGap)/float64(len(values))))
	for i, item := range values {
		height := int((item.Value / maxValue) * plotHeight)
		x := left + int(barGap) + i*(barWidth+int(barGap))
		y := bottom - height
		drawRect(img, x, y, barWidth, height, chartPalette[i%len(chartPalette)].rgba)
	}
}

func renderPiePNG(img *image.RGBA, values []chartDatum) {
	total := sumChartValues(values)
	cx, cy, radius := chartWidth/2, chartHeight/2+10, 190
	angles := make([]float64, len(values))
	cumulative := 0.0
	for i, item := range values {
		cumulative += (item.Value / total) * 2 * math.Pi
		angles[i] = cumulative
	}
	for y := cy - radius; y <= cy+radius; y++ {
		for x := cx - radius; x <= cx+radius; x++ {
			dx, dy := float64(x-cx), float64(y-cy)
			if dx*dx+dy*dy > float64(radius*radius) {
				continue
			}
			angle := math.Atan2(dy, dx) + math.Pi/2
			if angle < 0 {
				angle += 2 * math.Pi
			}
			idx := 0
			for idx < len(angles)-1 && angle > angles[idx] {
				idx++
			}
			img.Set(x, y, chartPalette[idx%len(chartPalette)].rgba)
		}
	}
}

type chartColor struct {
	hex  string
	rgba color.RGBA
}

var chartPalette = []chartColor{
	{hex: "#2563eb", rgba: color.RGBA{37, 99, 235, 255}},
	{hex: "#16a34a", rgba: color.RGBA{22, 163, 74, 255}},
	{hex: "#f97316", rgba: color.RGBA{249, 115, 22, 255}},
	{hex: "#7c3aed", rgba: color.RGBA{124, 58, 237, 255}},
	{hex: "#dc2626", rgba: color.RGBA{220, 38, 38, 255}},
	{hex: "#0891b2", rgba: color.RGBA{8, 145, 178, 255}},
}

func drawRect(img *image.RGBA, x, y, width, height int, fill color.Color) {
	if width <= 0 || height <= 0 {
		return
	}
	draw.Draw(img, image.Rect(x, y, x+width, y+height), &image.Uniform{C: fill}, image.Point{}, draw.Src)
}

func maxChartValue(values []chartDatum) float64 {
	maxValue := 0.0
	for _, item := range values {
		if item.Value > maxValue {
			maxValue = item.Value
		}
	}
	if maxValue <= 0 {
		return 1
	}
	return maxValue
}

func sumChartValues(values []chartDatum) float64 {
	total := 0.0
	for _, item := range values {
		if item.Value > 0 {
			total += item.Value
		}
	}
	if total <= 0 {
		return 1
	}
	return total
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	}
	return 0
}

func chartWriteErrorMessage(err error) string {
	var writeErr ChartWriteError
	if errors.As(err, &writeErr) {
		switch writeErr.Kind {
		case ChartWriteFailureDirectory:
			return "Error: " + writeErr.Error()
		case ChartWriteFailureFile:
			return "Error creating chart file: " + writeErr.Error()
		}
	}
	return "Error saving chart: " + err.Error()
}
