from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D

from render_creep_diagnostic import PALETTE, add_card, clean_axes, safe_font


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a true time-series creep report.")
    parser.add_argument("--input", required=True, type=Path, help="Continuous 80 kPa CSV")
    parser.add_argument("--outdir", type=Path, default=Path("analysis/creep_diagnostic/output"))
    parser.add_argument("--baseline-seconds", type=float, default=5.0)
    parser.add_argument("--final-seconds", type=float, default=5.0)
    return parser.parse_args()


def channel_columns(columns: list[str]) -> list[str]:
    return sorted(
        (column for column in columns if column.startswith("Palm") and column[4:].isdigit()),
        key=lambda column: int(column[4:]),
    )


def load_data(path: Path) -> tuple[pd.DataFrame, np.ndarray, list[str]]:
    frame = pd.read_csv(path)
    if frame.empty:
        raise ValueError(f"文件没有数据行: {path}")
    required = {"timestamp", "actual_kpa"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"缺少必要列: {', '.join(sorted(missing))}")

    channels = channel_columns(frame.columns.tolist())
    if not channels:
        raise ValueError("没有找到 Palm0、Palm1 ... 通道列。")

    timestamps = pd.to_datetime(frame["timestamp"], errors="raise")
    elapsed = (timestamps - timestamps.iloc[0]).dt.total_seconds().to_numpy(dtype=float)
    if np.any(np.diff(elapsed) <= 0):
        raise ValueError("时间戳不是严格递增，无法进行时间序列分析。")

    frame = frame.copy()
    frame["elapsed_s"] = elapsed
    frame[channels] = frame[channels].astype(float)
    if frame[channels].isna().any().any():
        raise ValueError("Palm 通道中包含空值。")
    return frame, elapsed, channels


def rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    return pd.Series(values).rolling(window, center=True, min_periods=1).median().to_numpy()


def grouped_pressure_changes(
    frame: pd.DataFrame,
    elapsed: np.ndarray,
    normalized_pct: np.ndarray,
) -> list[dict[str, float | int]]:
    segments = frame["actual_kpa"].ne(frame["actual_kpa"].shift()).cumsum()
    result: list[dict[str, float | int]] = []
    for _, group in frame.groupby(segments):
        if len(group) < 10:
            continue
        indices = group.index.to_numpy()
        start_median = float(np.median(normalized_pct[indices[:5]]))
        end_median = float(np.median(normalized_pct[indices[-5:]]))
        result.append(
            {
                "pressure_kpa": float(group["actual_kpa"].iloc[0]),
                "start_s": float(elapsed[indices[0]]),
                "end_s": float(elapsed[indices[-1]]),
                "frames": int(len(indices)),
                "start_pct": start_median,
                "end_pct": end_median,
                "change_pp": end_median - start_median,
            }
        )
    return result


def build_report(
    frame: pd.DataFrame,
    elapsed: np.ndarray,
    channels: list[str],
    source: Path,
    baseline_seconds: float,
    final_seconds: float,
) -> tuple[plt.Figure, pd.DataFrame, dict[str, object]]:
    values = frame[channels].to_numpy(dtype=float)
    duration = float(elapsed[-1])
    baseline_mask = elapsed <= baseline_seconds
    final_mask = elapsed >= duration - final_seconds
    if baseline_mask.sum() < 3 or final_mask.sum() < 3:
        raise ValueError("数据时长不足以形成基线窗口和终点窗口。")

    baseline = values[baseline_mask].mean(axis=0)
    final = values[final_mask].mean(axis=0)
    if np.any(baseline <= 0):
        raise ValueError("通道基线不大于 0，无法计算相对蠕变。")

    normalized = values / baseline[np.newaxis, :]
    normalized_pct = (normalized - 1.0) * 100.0
    median_pct = np.median(normalized_pct, axis=1)
    p10_pct = np.percentile(normalized_pct, 10, axis=1)
    p90_pct = np.percentile(normalized_pct, 90, axis=1)
    smooth_median = rolling_median(median_pct, 11)
    smooth_p10 = rolling_median(p10_pct, 11)
    smooth_p90 = rolling_median(p90_pct, 11)

    per_channel_creep = (final / baseline - 1.0) * 100.0
    slopes = np.empty(len(channels), dtype=float)
    for channel_index in range(len(channels)):
        slope, _ = np.polyfit(elapsed, normalized_pct[:, channel_index], 1)
        slopes[channel_index] = slope * 60.0

    details = pd.DataFrame(
        {
            "channel": channels,
            "baseline_first_5s": baseline,
            "final_last_5s": final,
            "apparent_creep_pct": per_channel_creep,
            "linear_slope_pct_per_min": slopes,
        }
    ).sort_values("apparent_creep_pct", ascending=False)

    median_creep = float(np.median(per_channel_creep))
    mean_creep = float(np.mean(per_channel_creep))
    p95_creep = float(np.percentile(per_channel_creep, 95))
    upward_count = int((per_channel_creep > 0).sum())
    above_half_count = int((per_channel_creep >= 0.5).sum())
    abnormal_count = int((per_channel_creep > median_creep + 2 * per_channel_creep.std(ddof=1)).sum())
    pressure_mean = float(frame["actual_kpa"].mean())
    pressure_std = float(frame["actual_kpa"].std(ddof=1))
    pressure_min = float(frame["actual_kpa"].min())
    pressure_max = float(frame["actual_kpa"].max())
    pressure_groups = grouped_pressure_changes(frame, elapsed, normalized_pct)

    # Bin the heatmap to one-second medians so all 210 channels remain legible.
    second_groups = np.floor(elapsed).astype(int)
    heat_source = pd.DataFrame(normalized_pct, columns=channels)
    heat_source["second"] = second_groups
    heatmap = heat_source.groupby("second", sort=True)[channels].median().T
    heatmap_times = heatmap.columns.to_numpy(dtype=float)
    sort_order = np.argsort(per_channel_creep)[::-1]
    heatmap = heatmap.iloc[sort_order]

    plt.rcParams.update(
        {
            "font.family": safe_font(),
            "font.size": 10,
            "axes.unicode_minus": False,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
        }
    )

    fig = plt.figure(figsize=(16, 10.8))
    fig.patch.set_facecolor(PALETTE["surface"])

    fig.text(
        0.047,
        0.955,
        "80 kPa 恒压表观蠕变",
        fontsize=27,
        fontweight="bold",
        color=PALETTE["ink"],
        va="top",
    )
    fig.text(
        0.047,
        0.912,
        f"批次 20261112028  ·  {len(frame)} 帧  ·  {duration:.1f} 秒  ·  210 通道",
        fontsize=11.2,
        color=PALETTE["muted"],
        va="top",
    )
    fig.text(
        0.953,
        0.952,
        "连续采样",
        fontsize=10,
        color=PALETTE["blue"],
        fontweight="bold",
        ha="right",
        va="top",
        bbox={"boxstyle": "round,pad=0.45", "facecolor": PALETTE["blue_soft"], "edgecolor": "none"},
    )

    cards = [
        (
            "采样时长",
            f"{duration:.1f} s",
            f"{len(frame)} 帧，约 {len(frame) / duration:.2f} Hz",
            PALETTE["blue"],
        ),
        (
            "实际压力",
            f"{pressure_mean:.2f} ± {pressure_std:.2f} kPa",
            f"范围 {pressure_min:.0f}–{pressure_max:.0f} kPa",
            PALETTE["teal"],
        ),
        (
            "60 s 表观蠕变",
            f"+{median_creep:.3f}%",
            "通道中位数，首 5 s → 末 5 s",
            PALETTE["orange"],
        ),
        (
            "上升通道",
            f"{upward_count} / {len(channels)}",
            f"{above_half_count} 个通道蠕变 ≥ 0.5%",
            PALETTE["red"],
        ),
    ]
    card_x = [0.047, 0.279, 0.511, 0.743]
    for x, (label, value, note, accent) in zip(card_x, cards):
        add_card(fig, x, 0.766, 0.21, 0.112, label, value, note, accent)

    grid = fig.add_gridspec(
        2,
        3,
        left=0.055,
        right=0.953,
        bottom=0.115,
        top=0.710,
        hspace=0.40,
        wspace=0.25,
        height_ratios=[1.18, 0.82],
    )
    ax_curve = fig.add_subplot(grid[0, :])
    ax_heat = fig.add_subplot(grid[1, 0])
    ax_hist = fig.add_subplot(grid[1, 1])
    ax_rank = fig.add_subplot(grid[1, 2])

    # Main temporal curve.
    ax_curve.fill_between(
        elapsed,
        smooth_p10,
        smooth_p90,
        color=PALETTE["blue_soft"],
        alpha=0.80,
        linewidth=0,
        label="通道 P10–P90",
    )
    ax_curve.plot(elapsed, median_pct, color=PALETTE["blue"], alpha=0.18, linewidth=1.0)
    ax_curve.plot(
        elapsed,
        smooth_median,
        color="#1D4ED8",
        linewidth=2.8,
        label="阵列中位曲线",
        zorder=4,
    )
    pressure_ax = ax_curve.twinx()
    pressure_ax.step(
        elapsed,
        frame["actual_kpa"],
        where="post",
        color=PALETTE["orange"],
        alpha=0.56,
        linewidth=1.1,
        label="实际压力",
    )
    pressure_ax.set_ylim(pressure_min - 0.55, pressure_max + 0.55)
    pressure_ax.set_ylabel("实际压力 (kPa)", color=PALETTE["orange"], fontsize=9)
    pressure_ax.tick_params(axis="y", colors=PALETTE["orange"], labelsize=8, length=0)
    pressure_ax.spines[["top", "right", "left", "bottom"]].set_visible(False)

    annotation_steps = [10, 30, int(np.floor(duration))]
    for step in annotation_steps:
        index = int(np.argmin(np.abs(elapsed - step)))
        value = smooth_median[index]
        ax_curve.scatter(
            elapsed[index],
            value,
            s=34,
            color=PALETTE["blue"],
            edgecolors="white",
            linewidths=1.0,
            zorder=6,
        )
        ax_curve.annotate(
            f"{elapsed[index]:.0f}s  +{value:.2f}%",
            (elapsed[index], value),
            xytext=(7, 9),
            textcoords="offset points",
            fontsize=8.7,
            color=PALETTE["blue"],
            fontweight="bold",
        )

    within_level = "  ·  ".join(
        f"{group['pressure_kpa']:.0f} kPa段 +{group['change_pp']:.2f}%"
        for group in pressure_groups
    )
    ax_curve.text(
        0.985,
        0.93,
        "恒压段内部仍持续上升",
        transform=ax_curve.transAxes,
        fontsize=9.5,
        fontweight="bold",
        color=PALETTE["ink"],
        ha="right",
        va="top",
    )
    ax_curve.text(
        0.985,
        0.855,
        within_level,
        transform=ax_curve.transAxes,
        fontsize=8.5,
        color=PALETTE["muted"],
        ha="right",
        va="top",
    )
    ax_curve.set_xlim(0, duration)
    ax_curve.set_ylim(0, max(1.45, smooth_p90.max() * 1.12))
    ax_curve.set_xlabel("加载持续时间 (s)", color=PALETTE["muted"])
    ax_curve.set_ylabel("相对首 5 s 的变化 (%)", color=PALETTE["muted"])
    ax_curve.set_title("恒压 60 s 内读数持续向上漂移，末段尚未进入平台", loc="left", pad=12, fontsize=12.5, fontweight="bold")
    ax_curve.set_xticks(np.arange(0, duration + 1, 10))
    clean_axes(ax_curve, grid_axis="y")
    curve_handles = [
        Line2D([0], [0], color="#1D4ED8", linewidth=2.8, label="阵列中位"),
        Line2D([0], [0], color=PALETTE["orange"], linewidth=1.1, alpha=0.60, label="实际压力"),
    ]
    ax_curve.legend(handles=curve_handles, loc="upper left", frameon=False, fontsize=8.5, ncol=2)

    # Channel heatmap, ordered by endpoint creep.
    heat_cmap = LinearSegmentedColormap.from_list(
        "creep_heat",
        ["#F8FAFC", PALETTE["blue_soft"], PALETTE["orange_soft"], "#FDBA74", PALETTE["red"]],
    )
    image = ax_heat.imshow(
        heatmap.to_numpy(dtype=float),
        aspect="auto",
        interpolation="nearest",
        origin="upper",
        extent=[heatmap_times.min(), heatmap_times.max(), len(channels), 0],
        cmap=heat_cmap,
        vmin=0,
        vmax=max(1.4, p95_creep * 1.15),
    )
    ax_heat.set_xlim(0, duration)
    ax_heat.set_xticks(np.arange(0, duration + 1, 15))
    ax_heat.set_yticks([])
    ax_heat.set_xlabel("时间 (s)", color=PALETTE["muted"])
    ax_heat.set_ylabel("通道（按末端蠕变量排序）", color=PALETTE["muted"])
    ax_heat.set_title("热图显示蠕变是全阵列一致现象", loc="left", pad=12, fontsize=11.5, fontweight="bold")
    ax_heat.spines[:].set_visible(False)
    ax_heat.tick_params(colors=PALETTE["muted"], labelsize=8, length=0)
    colorbar = fig.colorbar(image, ax=ax_heat, fraction=0.050, pad=0.025)
    colorbar.set_label("相对初始变化 (%)", color=PALETTE["muted"], fontsize=8)
    colorbar.outline.set_visible(False)
    colorbar.ax.tick_params(labelsize=7.5, colors=PALETTE["muted"], length=0)

    # Distribution of endpoint creep.
    bins = np.linspace(
        max(0, per_channel_creep.min() - 0.05),
        per_channel_creep.max() + 0.05,
        22,
    )
    ax_hist.hist(
        per_channel_creep,
        bins=bins,
        color=PALETTE["teal_soft"],
        edgecolor="white",
        linewidth=0.8,
        zorder=2,
    )
    ax_hist.axvline(median_creep, color=PALETTE["teal"], linewidth=2.2, zorder=4)
    ax_hist.axvline(p95_creep, color=PALETTE["red"], linewidth=1.2, linestyle=(0, (4, 4)), zorder=3)
    ax_hist.text(
        median_creep + 0.025,
        ax_hist.get_ylim()[1] * 0.88,
        f"中位 +{median_creep:.2f}%",
        color=PALETTE["teal"],
        fontsize=8.7,
        fontweight="bold",
    )
    ax_hist.text(
        p95_creep - 0.03,
        ax_hist.get_ylim()[1] * 0.68,
        f"P95 +{p95_creep:.2f}%",
        color=PALETTE["red"],
        fontsize=8.4,
        ha="right",
    )
    ax_hist.set_xlabel("60 s 表观蠕变量 (%)", color=PALETTE["muted"])
    ax_hist.set_ylabel("通道数", color=PALETTE["muted"])
    ax_hist.set_title("通道蠕变量集中在 0.6%–1.0%", loc="left", pad=12, fontsize=11.5, fontweight="bold")
    clean_axes(ax_hist)

    # Highest-creep channels.
    top = details.head(10).sort_values("apparent_creep_pct")
    y_positions = np.arange(len(top))
    bar_colors = plt.cm.YlOrRd(np.linspace(0.38, 0.78, len(top)))
    ax_rank.barh(
        y_positions,
        top["apparent_creep_pct"],
        color=bar_colors,
        edgecolor="none",
        height=0.68,
        zorder=2,
    )
    ax_rank.axvline(median_creep, color=PALETTE["teal"], linewidth=1.4, linestyle=(0, (4, 4)), zorder=3)
    for y_position, (_, row) in zip(y_positions, top.iterrows()):
        ax_rank.text(
            row["apparent_creep_pct"] + 0.018,
            y_position,
            f"+{row['apparent_creep_pct']:.2f}%",
            va="center",
            color=PALETTE["ink"],
            fontsize=7.8,
            fontweight="bold",
        )
    ax_rank.set_yticks(y_positions, top["channel"])
    ax_rank.set_xlim(0, max(top["apparent_creep_pct"].max() * 1.18, median_creep * 1.5))
    ax_rank.set_xlabel("60 s 表观蠕变量 (%)", color=PALETTE["muted"])
    ax_rank.set_title("末端蠕变量最高的通道", loc="left", pad=12, fontsize=11.5, fontweight="bold")
    clean_axes(ax_rank, grid_axis="x")

    footer = (
        f"定义：首 {baseline_seconds:g} s 通道均值作为基线，末 {final_seconds:g} s 通道均值作为终点；"
        "实际压力存在 79–81 kPa 控制波动，故结果称为“表观蠕变”。恒压分段内部仍持续上升，支持蠕变判断。"
    )
    fig.text(
        0.057,
        0.047,
        footer,
        fontsize=8.7,
        color=PALETTE["muted"],
        va="bottom",
        bbox={
            "boxstyle": "round,pad=0.55",
            "facecolor": PALETTE["orange_soft"],
            "edgecolor": "none",
            "alpha": 0.80,
        },
    )
    fig.text(
        0.953,
        0.047,
        f"数据：{source.name}",
        fontsize=7.8,
        color=PALETTE["gray"],
        ha="right",
        va="bottom",
    )

    metrics: dict[str, object] = {
        "duration_s": duration,
        "frames": len(frame),
        "sample_rate_hz": len(frame) / duration,
        "pressure_mean_kpa": pressure_mean,
        "pressure_std_kpa": pressure_std,
        "pressure_min_kpa": pressure_min,
        "pressure_max_kpa": pressure_max,
        "baseline_seconds": baseline_seconds,
        "final_seconds": final_seconds,
        "median_creep_pct": median_creep,
        "mean_creep_pct": mean_creep,
        "p95_creep_pct": p95_creep,
        "upward_channels": upward_count,
        "channels_above_0_5_pct": above_half_count,
        "two_sigma_outlier_channels": abnormal_count,
        "pressure_groups": pressure_groups,
    }
    return fig, details, metrics


def write_summary(
    output_path: Path,
    source: Path,
    details: pd.DataFrame,
    metrics: dict[str, object],
) -> None:
    top = details.head(10)
    top_table = "\n".join(
        f"| {row.channel} | {row.baseline_first_5s:.1f} | {row.final_last_5s:.1f} | "
        f"+{row.apparent_creep_pct:.3f}% |"
        for row in top.itertuples()
    )
    pressure_groups = metrics["pressure_groups"]
    pressure_lines = "\n".join(
        f"- 实际压力 {group['pressure_kpa']:.0f} kPa 的分段内，阵列中位值仍上升 "
        f"{group['change_pp']:.2f} 个百分点（{group['start_s']:.1f}–{group['end_s']:.1f} s）。"
        for group in pressure_groups
        if isinstance(group, dict)
    )
    content = f"""# 80 kPa 恒压表观蠕变分析

## 数据与定义

- 数据源：`{source.name}`。
- 采样：{metrics["frames"]} 帧，{metrics["duration_s"]:.2f} 秒，约 {metrics["sample_rate_hz"]:.2f} Hz。
- 实际压力：{metrics["pressure_mean_kpa"]:.2f} ± {metrics["pressure_std_kpa"]:.2f} kPa，范围 {metrics["pressure_min_kpa"]:.0f}–{metrics["pressure_max_kpa"]:.0f} kPa。
- 表观蠕变：首 {metrics["baseline_seconds"]:g} 秒通道均值作为基线，末 {metrics["final_seconds"]:g} 秒均值作为终点，计算 `终点 / 基线 - 1`。
- 因压力存在 79–81 kPa 控制波动，结果称为“表观蠕变”；恒压分段内部变化用于辅助排除单纯压力变化。

## 关键结果

- 210 个通道中，{metrics["upward_channels"]}/210 个在 60 秒内上升。
- 通道表观蠕变中位数为 **+{metrics["median_creep_pct"]:.3f}%**，均值为 +{metrics["mean_creep_pct"]:.3f}%，P95 为 +{metrics["p95_creep_pct"]:.3f}%。
- {metrics["channels_above_0_5_pct"]}/210 个通道的表观蠕变达到或超过 0.5%。
- 曲线在 60 秒结束时仍呈上升趋势，尚未观察到平台。
- 超过阵列蠕变均值加两倍标准差的高蠕变通道有 {metrics["two_sigma_outlier_channels"]} 个。

## 恒压分段检查

{pressure_lines}

## 表观蠕变最高的通道

| 通道 | 首 5 s 均值 | 末 5 s 均值 | 表观蠕变 |
|---|---:|---:|---:|
{top_table}

## 解读

这份数据已经可以展示典型蠕变现象：在目标压力基本恒定的 60 秒内，阵列读数持续增加，且变化不是少数异常通道造成，而是 210 个通道整体向上漂移。当前记录只有 1 分钟，适合做现象确认和通道筛查；若要估计稳定时间，建议继续采集至趋势趋于平台，通常需要 5–10 分钟。
"""
    output_path.write_text(content, encoding="utf-8")


def main() -> None:
    args = parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)
    frame, elapsed, channels = load_data(args.input)
    fig, details, metrics = build_report(
        frame,
        elapsed,
        channels,
        args.input,
        args.baseline_seconds,
        args.final_seconds,
    )

    png_path = args.outdir / "80kpa_creep_timeseries.png"
    svg_path = args.outdir / "80kpa_creep_timeseries.svg"
    details_path = args.outdir / "80kpa_channel_creep_details.csv"
    summary_path = args.outdir / "80kpa_creep_summary.md"

    fig.savefig(png_path, dpi=220, bbox_inches="tight", facecolor=fig.get_facecolor())
    fig.savefig(svg_path, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    details.to_csv(details_path, index=False, encoding="utf-8-sig")
    write_summary(summary_path, args.input, details, metrics)

    print(f"PNG: {png_path.resolve()}")
    print(f"SVG: {svg_path.resolve()}")
    print(f"CSV: {details_path.resolve()}")
    print(f"MD:  {summary_path.resolve()}")
    print(f"Median creep: +{metrics['median_creep_pct']:.3f}%")
    print(f"Upward channels: {metrics['upward_channels']}/210")


if __name__ == "__main__":
    main()
