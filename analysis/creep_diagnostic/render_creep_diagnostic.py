from __future__ import annotations

import argparse
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib import font_manager
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import FancyBboxPatch


PALETTE = {
    "ink": "#172033",
    "muted": "#667085",
    "border": "#D8DEE9",
    "surface": "#F7F9FC",
    "blue": "#2563EB",
    "blue_soft": "#DBEAFE",
    "orange": "#EA580C",
    "orange_soft": "#FFEDD5",
    "teal": "#0F766E",
    "teal_soft": "#CCFBF1",
    "red": "#DC2626",
    "red_soft": "#FEE2E2",
    "gray": "#98A2B3",
}


def channel_columns(columns: list[str]) -> list[str]:
    return sorted(
        (column for column in columns if re.fullmatch(r"Palm\d+", column)),
        key=lambda column: int(column[4:]),
    )


def load_summary(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    if frame.empty:
        raise ValueError(f"文件没有数据行: {path}")
    return frame


def representative_row(frame: pd.DataFrame, label: str) -> pd.Series:
    if len(frame) == 1:
        return frame.iloc[0]

    if "sample_count" not in frame:
        return frame.iloc[-1]

    target_count = frame["sample_count"].median()
    index = (frame["sample_count"] - target_count).abs().idxmin()
    row = frame.loc[index].copy()
    row["_selection_note"] = f"{label} 包含 {len(frame)} 个时间点，图中取样本数最接近中位数的稳态行。"
    return row


def validate_pair(low: pd.Series, high: pd.Series) -> list[str]:
    low_columns = channel_columns(low.index.tolist())
    high_columns = channel_columns(high.index.tolist())
    if low_columns != high_columns:
        raise ValueError("10 kPa 与 80 kPa 文件的 Palm 通道不一致。")
    if not low_columns:
        raise ValueError("文件中没有找到 Palm0、Palm1 ... 通道列。")
    return low_columns


def safe_font() -> str:
    candidates = ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "Arial Unicode MS"]
    for candidate in candidates:
        try:
            font_manager.findfont(candidate, fallback_to_default=False)
            return candidate
        except ValueError:
            continue
    return "DejaVu Sans"


def add_card(
    fig: plt.Figure,
    x: float,
    y: float,
    width: float,
    height: float,
    label: str,
    value: str,
    note: str,
    accent: str,
) -> None:
    card = FancyBboxPatch(
        (x, y),
        width,
        height,
        transform=fig.transFigure,
        boxstyle="round,pad=0.008,rounding_size=0.014",
        facecolor="white",
        edgecolor=PALETTE["border"],
        linewidth=0.9,
        zorder=10,
    )
    fig.patches.append(card)
    fig.add_artist(
        Line2D(
            [x + 0.012, x + 0.012],
            [y + 0.012, y + height - 0.012],
            transform=fig.transFigure,
            color=accent,
            linewidth=3.5,
            solid_capstyle="round",
            zorder=11,
        )
    )
    fig.text(
        x + 0.027,
        y + height - 0.026,
        label,
        color=PALETTE["muted"],
        fontsize=8.8,
        va="top",
        zorder=12,
    )
    fig.text(
        x + 0.027,
        y + height - 0.060,
        value,
        color=PALETTE["ink"],
        fontsize=18,
        fontweight="bold",
        va="top",
        zorder=12,
    )
    fig.text(
        x + 0.027,
        y + 0.018,
        note,
        color=PALETTE["muted"],
        fontsize=8.2,
        va="bottom",
        zorder=12,
    )


def clean_axes(ax: plt.Axes, grid_axis: str | None = "y") -> None:
    ax.spines[["top", "right", "left", "bottom"]].set_visible(False)
    if grid_axis:
        ax.grid(axis=grid_axis, color=PALETTE["border"], linewidth=0.7, alpha=0.8)
    ax.tick_params(colors=PALETTE["muted"], labelsize=9, length=0)
    ax.set_axisbelow(True)


def build_figure(
    low: pd.Series,
    high: pd.Series,
    channels: list[str],
    low_file: Path,
    high_file: Path,
) -> tuple[plt.Figure, pd.DataFrame, dict[str, float | int | str]]:
    low_values = low[channels].astype(float).to_numpy()
    high_values = high[channels].astype(float).to_numpy()
    delta = high_values - low_values
    delta_pct = delta / low_values * 100

    details = pd.DataFrame(
        {
            "channel": channels,
            "low_10kpa": low_values,
            "high_80kpa": high_values,
            "absolute_change": delta,
            "relative_change_pct": delta_pct,
        }
    ).sort_values("relative_change_pct", ascending=False)

    threshold = 20.0
    high_risk_count = int((delta_pct > threshold).sum())
    low_mean = float(np.mean(low_values))
    high_mean = float(np.mean(high_values))
    low_median = float(np.median(low_values))
    high_median = float(np.median(high_values))
    median_change_pct = float(np.median(delta_pct))
    cv_low_pct = float(np.std(low_values, ddof=1) / low_mean * 100)
    cv_high_pct = float(np.std(high_values, ddof=1) / high_mean * 100)
    target_low = float(low.get("target_kpa", np.nan))
    target_high = float(high.get("target_kpa", np.nan))
    actual_low = float(low.get("actual_avg_kpa", np.nan))
    actual_high = float(high.get("actual_avg_kpa", np.nan))
    pressure_change_pct = (actual_high / actual_low - 1) * 100

    top = details.head(5).copy()
    top_labels = top["channel"].tolist()

    plt.rcParams.update(
        {
            "font.family": safe_font(),
            "font.size": 10,
            "axes.unicode_minus": False,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
        }
    )

    fig = plt.figure(figsize=(16, 10.7))
    fig.patch.set_facecolor(PALETTE["surface"])

    fig.text(
        0.047,
        0.955,
        "触觉阵列蠕变风险筛查",
        fontsize=27,
        fontweight="bold",
        color=PALETTE["ink"],
        va="top",
    )
    fig.text(
        0.047,
        0.912,
        f"批次 20261112028  ·  10 → 80 kPa 稳态响应对比  ·  210 通道",
        fontsize=11.2,
        color=PALETTE["muted"],
        va="top",
    )
    fig.text(
        0.953,
        0.952,
        "诊断图",
        fontsize=10,
        color=PALETTE["blue"],
        fontweight="bold",
        ha="right",
        va="top",
        bbox={"boxstyle": "round,pad=0.45", "facecolor": PALETTE["blue_soft"], "edgecolor": "none"},
    )

    cards = [
        (
            "压力控制",
            f"{actual_low:.2f} → {actual_high:.2f} kPa",
            f"目标 {target_low:g} → {target_high:g} kPa",
            PALETTE["blue"],
        ),
        (
            "通道中位变化",
            f"+{median_change_pct:.2f}%",
            f"压力增加 {pressure_change_pct:.1f}%",
            PALETTE["teal"],
        ),
        (
            "阵列离散度 CV",
            f"{cv_low_pct:.2f}% → {cv_high_pct:.2f}%",
            f"高载离散度扩大 {cv_high_pct - cv_low_pct:.2f} 个百分点",
            PALETTE["orange"],
        ),
        (
            f"相对变化 > {threshold:.0f}%",
            f"{high_risk_count} / {len(channels)}",
            "建议优先复测的高响应通道",
            PALETTE["red"],
        ),
    ]
    card_x = [0.047, 0.279, 0.511, 0.743]
    for x, (label, value, note, accent) in zip(card_x, cards):
        add_card(fig, x, 0.766, 0.21, 0.112, label, value, note, accent)

    grid = fig.add_gridspec(
        2,
        2,
        left=0.055,
        right=0.953,
        bottom=0.112,
        top=0.715,
        hspace=0.37,
        wspace=0.20,
        height_ratios=[1, 1],
    )
    ax_dist = fig.add_subplot(grid[0, 0])
    ax_scatter = fig.add_subplot(grid[0, 1])
    ax_rank = fig.add_subplot(grid[1, 0])
    ax_top = fig.add_subplot(grid[1, 1])

    # Panel 1: load-level distributions.
    rng = np.random.default_rng(20261112)
    jitter_low = rng.normal(1.0, 0.035, size=len(low_values))
    jitter_high = rng.normal(2.0, 0.035, size=len(high_values))
    ax_dist.scatter(
        jitter_low,
        low_values,
        s=13,
        color=PALETTE["blue"],
        alpha=0.28,
        edgecolors="none",
        zorder=2,
    )
    ax_dist.scatter(
        jitter_high,
        high_values,
        s=13,
        color=PALETTE["orange"],
        alpha=0.30,
        edgecolors="none",
        zorder=2,
    )
    box = ax_dist.boxplot(
        [low_values, high_values],
        positions=[1, 2],
        widths=0.45,
        patch_artist=True,
        showfliers=False,
        medianprops={"color": PALETTE["ink"], "linewidth": 2.0},
        whiskerprops={"color": PALETTE["gray"], "linewidth": 1.0},
        capprops={"color": PALETTE["gray"], "linewidth": 1.0},
    )
    for patch, color in zip(box["boxes"], [PALETTE["blue_soft"], PALETTE["orange_soft"]]):
        patch.set_facecolor(color)
        patch.set_edgecolor("none")
        patch.set_alpha(0.88)
    ax_dist.scatter(
        [1, 2],
        [low_mean, high_mean],
        marker="D",
        s=36,
        color=["#1D4ED8", "#C2410C"],
        edgecolors="white",
        linewidths=0.8,
        zorder=5,
    )
    ax_dist.set_xticks([1, 2], ["10 kPa\n385 samples", "80 kPa\n376 samples"])
    ax_dist.set_ylabel("校准后通道读数", color=PALETTE["muted"])
    ax_dist.set_title("通道分布随载荷整体上移，但高载离散度更大", loc="left", pad=12, fontsize=12.5, fontweight="bold")
    ax_dist.text(
        0.02,
        0.97,
        f"median: {low_median:.1f} → {high_median:.1f}    mean: {low_mean:.1f} → {high_mean:.1f}",
        transform=ax_dist.transAxes,
        fontsize=8.6,
        color=PALETTE["muted"],
        va="top",
    )
    clean_axes(ax_dist)

    # Panel 2: channel-by-channel pair plot.
    color_map = LinearSegmentedColormap.from_list(
        "change",
        [PALETTE["blue_soft"], PALETTE["teal_soft"], PALETTE["orange_soft"], PALETTE["red_soft"]],
    )
    norm = matplotlib.colors.Normalize(vmin=0, vmax=threshold)
    scatter = ax_scatter.scatter(
        low_values,
        high_values,
        c=np.clip(delta_pct, 0, threshold),
        cmap=color_map,
        norm=norm,
        s=26,
        alpha=0.88,
        edgecolors="white",
        linewidths=0.45,
        zorder=3,
    )
    lower = min(low_values.min(), high_values.min())
    upper = max(low_values.max(), high_values.max())
    margin = (upper - lower) * 0.08
    ax_scatter.plot(
        [lower - margin, upper + margin],
        [lower - margin, upper + margin],
        color=PALETTE["gray"],
        linestyle=(0, (4, 4)),
        linewidth=1.0,
        zorder=1,
        label="无变化线 y=x",
    )
    top_points = details.head(5)
    label_offsets = [(6, 7), (-12, 13), (-72, -15), (-8, -15), (7, 6)]
    for (_, row), offset in zip(top_points.iterrows(), label_offsets):
        ax_scatter.annotate(
            row["channel"],
            (row["low_10kpa"], row["high_80kpa"]),
            xytext=offset,
            textcoords="offset points",
            fontsize=8,
            color=PALETTE["ink"],
            fontweight="bold",
        )
    ax_scatter.set_xlim(lower - margin, upper + margin)
    ax_scatter.set_ylim(lower - margin, upper + margin)
    ax_scatter.set_xlabel("10 kPa 校准后读数", color=PALETTE["muted"])
    ax_scatter.set_ylabel("80 kPa 校准后读数", color=PALETTE["muted"])
    ax_scatter.set_title("少数通道远离主体，是复测与蠕变验证的重点", loc="left", pad=12, fontsize=12.5, fontweight="bold")
    ax_scatter.legend(loc="lower right", frameon=False, fontsize=8.2)
    colorbar = fig.colorbar(scatter, ax=ax_scatter, fraction=0.037, pad=0.025)
    colorbar.set_label("10→80 kPa 相对变化 (%)", color=PALETTE["muted"], fontsize=8.5)
    colorbar.outline.set_visible(False)
    colorbar.ax.tick_params(labelsize=8, colors=PALETTE["muted"], length=0)
    clean_axes(ax_scatter, grid_axis="both")

    # Panel 3: sorted response tail.
    sorted_pct = np.sort(delta_pct)[::-1]
    ranks = np.arange(1, len(sorted_pct) + 1)
    ax_rank.plot(ranks, sorted_pct, color=PALETTE["blue"], linewidth=2.1, zorder=3)
    ax_rank.fill_between(ranks, 0, sorted_pct, color=PALETTE["blue_soft"], alpha=0.65, zorder=1)
    ax_rank.axhline(
        threshold,
        color=PALETTE["red"],
        linestyle=(0, (4, 4)),
        linewidth=1.2,
        zorder=2,
    )
    ax_rank.scatter(ranks[:high_risk_count], sorted_pct[:high_risk_count], s=18, color=PALETTE["red"], zorder=4)
    ax_rank.text(
        len(channels) * 0.985,
        threshold + 0.7,
        f">20%：{high_risk_count} 通道",
        ha="right",
        va="bottom",
        color=PALETTE["red"],
        fontsize=9,
        fontweight="bold",
    )
    ax_rank.set_xlabel("通道排序（按相对变化降序）", color=PALETTE["muted"])
    ax_rank.set_ylabel("相对变化 (%)", color=PALETTE["muted"])
    ax_rank.set_title("响应尾部明显拉长，阵列一致性随载荷变差", loc="left", pad=12, fontsize=12.5, fontweight="bold")
    ax_rank.set_xlim(0, len(channels) + 1)
    ax_rank.set_ylim(0, max(sorted_pct.max() * 1.10, threshold * 1.4))
    clean_axes(ax_rank)

    # Panel 4: top movers as dumbbell bars.
    top_bar = details.head(10).sort_values("relative_change_pct")
    y_positions = np.arange(len(top_bar))
    ax_top.hlines(
        y_positions,
        top_bar["low_10kpa"],
        top_bar["high_80kpa"],
        color=PALETTE["border"],
        linewidth=3.0,
        zorder=1,
    )
    ax_top.scatter(
        top_bar["low_10kpa"],
        y_positions,
        s=42,
        color=PALETTE["blue"],
        edgecolors="white",
        linewidths=0.8,
        label="10 kPa",
        zorder=3,
    )
    ax_top.scatter(
        top_bar["high_80kpa"],
        y_positions,
        s=42,
        color=PALETTE["orange"],
        edgecolors="white",
        linewidths=0.8,
        label="80 kPa",
        zorder=3,
    )
    for index, (_, row) in enumerate(top_bar.iterrows()):
        ax_top.text(
            row["high_80kpa"] + 20,
            index,
            f"+{row['relative_change_pct']:.1f}%",
            va="center",
            fontsize=8.3,
            color=PALETTE["ink"],
            fontweight="bold",
        )
    ax_top.set_yticks(y_positions, top_bar["channel"])
    ax_top.set_xlabel("校准后通道读数", color=PALETTE["muted"])
    ax_top.set_title("高响应通道：高载下的变化显著偏离阵列中位数", loc="left", pad=12, fontsize=12.5, fontweight="bold")
    ax_top.legend(loc="lower right", frameon=False, fontsize=8.5, ncol=2)
    left_limit = top_bar[["low_10kpa", "high_80kpa"]].min().min() - 70
    right_limit = top_bar[["low_10kpa", "high_80kpa"]].max().max() + 150
    ax_top.set_xlim(left_limit, right_limit)
    clean_axes(ax_top, grid_axis="x")

    selection_notes = [
        value
        for value in (low.get("_selection_note"), high.get("_selection_note"))
        if isinstance(value, str)
    ]
    note_prefix = "".join(selection_notes)
    footer = (
        f"{note_prefix}现有两张 summary 均仅有 1 个稳态时间点，因此本图展示的是载荷响应与一致性筛查，"
        "不能直接计算蠕变率。真正的蠕变需在同一压力下连续记录读数随时间的变化。"
    )
    fig.text(
        0.057,
        0.045,
        footer,
        fontsize=8.8,
        color=PALETTE["muted"],
        va="bottom",
        bbox={
            "boxstyle": "round,pad=0.55",
            "facecolor": PALETTE["orange_soft"],
            "edgecolor": "none",
            "alpha": 0.8,
        },
    )
    fig.text(
        0.953,
        0.045,
        f"数据：{low_file.name}  |  {high_file.name}",
        fontsize=7.8,
        color=PALETTE["gray"],
        ha="right",
        va="bottom",
    )

    metrics: dict[str, float | int | str] = {
        "target_low_kpa": target_low,
        "actual_low_kpa": actual_low,
        "target_high_kpa": target_high,
        "actual_high_kpa": actual_high,
        "low_sample_count": int(low.get("sample_count", 0)),
        "high_sample_count": int(high.get("sample_count", 0)),
        "low_channel_mean": low_mean,
        "high_channel_mean": high_mean,
        "low_channel_median": low_median,
        "high_channel_median": high_median,
        "median_relative_change_pct": median_change_pct,
        "low_cv_pct": cv_low_pct,
        "high_cv_pct": cv_high_pct,
        "channels_above_20pct": high_risk_count,
        "top_channel": str(details.iloc[0]["channel"]),
        "top_channel_relative_change_pct": float(details.iloc[0]["relative_change_pct"]),
        "top_labels": ", ".join(top_labels),
    }
    return fig, details, metrics


def write_summary(
    output_path: Path,
    low_file: Path,
    high_file: Path,
    details: pd.DataFrame,
    metrics: dict[str, float | int | str],
) -> None:
    top_rows = details.head(10)
    top_table = "\n".join(
        f"| {row.channel} | {row.low_10kpa:.1f} | {row.high_80kpa:.1f} | "
        f"+{row.absolute_change:.1f} | +{row.relative_change_pct:.2f}% |"
        for row in top_rows.itertuples()
    )
    content = f"""# 触觉阵列蠕变风险筛查

## 数据范围

- 10 kPa：`{low_file.name}`，实际压力 {metrics["actual_low_kpa"]:.3f} kPa，样本 {metrics["low_sample_count"]}。
- 80 kPa：`{high_file.name}`，实际压力 {metrics["actual_high_kpa"]:.3f} kPa，样本 {metrics["high_sample_count"]}。
- 两个文件各只有 1 个时间点，因此无法直接计算随时间变化的蠕变量、蠕变速率或稳定时间。
- 本报告是基于 10→80 kPa 的稳态响应筛查，用于定位响应异常通道，并不等同于蠕变结论。

## 关键结果

- 压力从 {metrics["actual_low_kpa"]:.2f} kPa 提高到 {metrics["actual_high_kpa"]:.2f} kPa。
- 210 个通道读数的中位数从 {metrics["low_channel_median"]:.1f} 提高到 {metrics["high_channel_median"]:.1f}，中位相对变化为 +{metrics["median_relative_change_pct"]:.2f}%。
- 通道离散系数由 {metrics["low_cv_pct"]:.2f}% 扩大到 {metrics["high_cv_pct"]:.2f}%，说明高载下阵列一致性变差。
- 有 {metrics["channels_above_20pct"]} 个通道相对变化超过 20%，建议列为重复加载与持压测试的首批复测对象。
- 最大相对变化通道为 {metrics["top_channel"]}（+{metrics["top_channel_relative_change_pct"]:.2f}%）。

## 高响应通道

| 通道 | 10 kPa | 80 kPa | 绝对变化 | 相对变化 |
|---|---:|---:|---:|---:|
{top_table}

## 建议的蠕变验证采集

1. 在同一目标压力（建议 80 kPa）下保持加载 5–10 分钟。
2. 持续保存每个通道的逐帧读数、时间戳和实际压力，不要只保存最后一行 summary。
3. 至少重复 3 次加载—持压—卸载循环，用于区分接触位置差异、迟滞和真正的蠕变。
4. 蠕变指标建议使用 `读数(t) / 读数(t0)`、峰值下降、末段斜率及卸载后残余偏移。
"""
    output_path.write_text(content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a tactile-array response diagnostic figure.")
    parser.add_argument("--low", required=True, type=Path, help="10 kPa summary CSV")
    parser.add_argument("--high", required=True, type=Path, help="80 kPa summary CSV")
    parser.add_argument("--outdir", type=Path, default=Path("analysis/creep_diagnostic/output"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)
    low_frame = load_summary(args.low)
    high_frame = load_summary(args.high)
    low = representative_row(low_frame, "10 kPa")
    high = representative_row(high_frame, "80 kPa")
    channels = validate_pair(low, high)

    fig, details, metrics = build_figure(low, high, channels, args.low, args.high)
    png_path = args.outdir / "tactile_creep_risk_diagnostic.png"
    svg_path = args.outdir / "tactile_creep_risk_diagnostic.svg"
    csv_path = args.outdir / "channel_response_details.csv"
    md_path = args.outdir / "diagnostic_summary.md"

    fig.savefig(png_path, dpi=220, bbox_inches="tight", facecolor=fig.get_facecolor())
    fig.savefig(svg_path, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    details.to_csv(csv_path, index=False, encoding="utf-8-sig")
    write_summary(md_path, args.low, args.high, details, metrics)

    print(f"PNG: {png_path.resolve()}")
    print(f"SVG: {svg_path.resolve()}")
    print(f"CSV: {csv_path.resolve()}")
    print(f"MD:  {md_path.resolve()}")
    print(f"Channels above 20%: {metrics['channels_above_20pct']}")
    print(f"Top channels: {metrics['top_labels']}")


if __name__ == "__main__":
    main()
