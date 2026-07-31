/**
 * The TruckSetu lorry — a hand-drawn Indian goods carrier in SVG.
 *
 * Every element is the real thing you see on NH-48: the scalloped crown
 * board over the cab, a marigold garland across the windshield, painted
 * body panels with a "सेतु" medallion, the HORN PLEASE band, striped
 * bumper and hanging tassels. Pure vectors (react-native-svg), so it
 * renders crisp at any size on iOS, Android and web with zero assets.
 */

import React from 'react';
import Svg, {
  Circle,
  Ellipse,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

const ART = {
  cab: '#2C8C99',
  cabDark: '#1F6470',
  cabDeep: '#17414E',
  cream: '#F6E7C9',
  creamLine: '#E3C79B',
  red: '#C62828',
  redDeep: '#B8452B',
  green: '#1E8E3E',
  saffron: '#F5820D',
  marigold: '#F7C948',
  glass: '#BFE3F2',
  tyre: '#1F2430',
  rim: '#D9DEE8',
  rimLine: '#9AA4B5',
  steel: '#232B3A',
  pipe: '#4A5568',
} as const;

function Wheel({ cx, cy }: { cx: number; cy: number }): React.JSX.Element {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={28} fill={ART.tyre} />
      <Circle cx={cx} cy={cy} r={15} fill={ART.rim} stroke={ART.rimLine} strokeWidth={2} />
      {[0, 60, 120].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const dx = Math.cos(rad) * 13;
        const dy = Math.sin(rad) * 13;
        return (
          <Line
            key={deg}
            x1={cx - dx}
            y1={cy - dy}
            x2={cx + dx}
            y2={cy + dy}
            stroke={ART.rimLine}
            strokeWidth={2.5}
          />
        );
      })}
      <Circle cx={cx} cy={cy} r={6} fill={ART.saffron} stroke={ART.rimLine} strokeWidth={1.5} />
    </G>
  );
}

/** Marigold garland strung across the windshield top, with a gentle sag. */
function Garland(): React.JSX.Element {
  const dots: React.JSX.Element[] = [];
  for (let i = 0; i < 10; i++) {
    const x = 271 + i * 8;
    const t = i / 9;
    const sag = Math.sin(t * Math.PI) * 5;
    dots.push(
      <Circle
        key={i}
        cx={x}
        cy={84 + sag}
        r={3}
        fill={i % 2 === 0 ? ART.marigold : ART.saffron}
      />,
    );
  }
  return <G>{dots}</G>;
}

export function IndianTruck({
  width = 300,
  shadow = true,
}: {
  width?: number;
  /** Ground shadow — turn off when the truck sits on a drawn road. */
  shadow?: boolean;
}): React.JSX.Element {
  const height = (width * 240) / 420;
  return (
    <Svg width={width} height={height} viewBox="0 0 420 240">
      {shadow && <Ellipse cx={200} cy={229} rx={180} ry={7} fill="rgba(15,42,92,0.18)" />}

      {/* Chassis rail */}
      <Rect x={24} y={168} width={340} height={14} rx={3} fill={ART.steel} />

      {/* Exhaust stack behind the cab */}
      <Rect x={253} y={58} width={7} height={112} rx={3} fill={ART.pipe} />
      <Rect x={250} y={54} width={13} height={7} rx={3} fill={ART.steel} />

      {/* ---- Cargo body ---- */}
      <Rect x={24} y={58} width={238} height={112} rx={6} fill={ART.cream} stroke={ART.redDeep} strokeWidth={3} />
      {/* saffron top rail with painted dots */}
      <Rect x={26} y={60} width={234} height={17} rx={5} fill={ART.saffron} />
      {[44, 66, 88, 110, 132, 154, 176, 198, 220, 242].map((x) => (
        <Circle key={x} cx={x} cy={68.5} r={2.6} fill="#FFFFFF" />
      ))}
      {/* plank seams */}
      {[64, 104, 184, 224].map((x) => (
        <Line key={x} x1={x} y1={80} x2={x} y2={142} stroke={ART.creamLine} strokeWidth={2} />
      ))}
      {/* red inner frame */}
      <Rect x={34} y={84} width={218} height={56} rx={4} fill="none" stroke={ART.red} strokeWidth={2} />
      {/* सेतु medallion */}
      <Circle cx={143} cy={112} r={25} fill="#FFFFFF" stroke={ART.green} strokeWidth={3} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <Circle
            key={deg}
            cx={143 + Math.cos(rad) * 25}
            cy={112 + Math.sin(rad) * 25}
            r={3.4}
            fill={ART.marigold}
          />
        );
      })}
      <Circle cx={143} cy={112} r={16.5} fill={ART.saffron} />
      <SvgText
        x={143}
        y={118}
        fontSize={13}
        fontWeight="bold"
        fill="#FFFFFF"
        textAnchor="middle"
      >
        सेतु
      </SvgText>
      {/* permit lettering */}
      <SvgText x={72} y={106} fontSize={10} fontWeight="bold" fill={ART.redDeep} textAnchor="middle">
        ALL INDIA
      </SvgText>
      <SvgText x={72} y={119} fontSize={10} fontWeight="bold" fill={ART.redDeep} textAnchor="middle">
        PERMIT
      </SvgText>
      <SvgText x={214} y={113} fontSize={10} fontWeight="bold" fill={ART.cab} textAnchor="middle">
        GOODS
      </SvgText>
      <SvgText x={214} y={126} fontSize={10} fontWeight="bold" fill={ART.cab} textAnchor="middle">
        CARRIER
      </SvgText>
      {/* HORN PLEASE band */}
      <Rect x={27} y={146} width={232} height={21} rx={3} fill={ART.green} />
      <SvgText
        x={143}
        y={161}
        fontSize={13}
        fontWeight="bold"
        fill="#FFFFFF"
        textAnchor="middle"
        letterSpacing={4}
      >
        HORN PLEASE
      </SvgText>

      {/* ---- Cab (cab-over, facing right) ---- */}
      <Rect x={262} y={76} width={94} height={92} rx={8} fill={ART.cab} stroke={ART.cabDark} strokeWidth={2} />
      {/* sun visor */}
      <Rect x={260} y={70} width={100} height={11} rx={4} fill={ART.saffron} />
      {/* scalloped crown board */}
      {[281, 309, 337].map((x) => (
        <Circle key={x} cx={x} cy={46} r={8} fill={ART.red} />
      ))}
      <Rect x={266} y={44} width={86} height={26} rx={4} fill={ART.red} />
      <SvgText
        x={309}
        y={62}
        fontSize={12}
        fontWeight="bold"
        fill="#FFFFFF"
        textAnchor="middle"
      >
        TruckSetu
      </SvgText>
      {/* windshield */}
      <Rect x={270} y={88} width={72} height={34} rx={4} fill={ART.glass} stroke={ART.cabDeep} strokeWidth={2} />
      <Line x1={280} y1={118} x2={302} y2={92} stroke="#FFFFFF" strokeWidth={3} opacity={0.5} />
      <Garland />
      {/* painted waves on the door panel */}
      <Path d="M270 140 Q288 128 306 140 T342 140" stroke={ART.marigold} strokeWidth={3.5} fill="none" />
      <Path d="M270 152 Q288 140 306 152 T342 152" stroke="#FFFFFF" strokeWidth={2.5} fill="none" opacity={0.85} />
      {/* grille + headlight */}
      <Rect x={349} y={130} width={7} height={26} rx={2} fill={ART.cabDeep} />
      <Circle cx={352} cy={150} r={6} fill="#FFF3DF" stroke={ART.marigold} strokeWidth={2} />
      {/* mirror */}
      <Line x1={356} y1={88} x2={366} y2={80} stroke={ART.cabDeep} strokeWidth={2.5} />
      <Rect x={363} y={72} width={6} height={11} rx={2} fill={ART.cabDeep} />
      {/* front wheel arch */}
      <Path d="M290 168 A 30 30 0 0 1 346 168 L 346 168 L 290 168 Z" fill={ART.cabDeep} />
      {/* striped bumper */}
      <Rect x={344} y={168} width={26} height={16} rx={3} fill={ART.red} />
      <Line x1={352} y1={184} x2={360} y2={168} stroke="#FFFFFF" strokeWidth={4} />
      <Line x1={362} y1={184} x2={370} y2={168} stroke="#FFFFFF" strokeWidth={4} opacity={0.7} />
      {/* hanging tassels under the bumper */}
      {[347, 354, 361, 368].map((x, i) => (
        <Path
          key={x}
          d={`M${x} 184 L${x + 2.5} 196 L${x - 2.5} 196 Z`}
          fill={i % 2 === 0 ? ART.marigold : ART.red}
        />
      ))}

      {/* ---- Wheels ---- */}
      <Wheel cx={78} cy={196} />
      <Wheel cx={140} cy={196} />
      <Wheel cx={318} cy={196} />
    </Svg>
  );
}
