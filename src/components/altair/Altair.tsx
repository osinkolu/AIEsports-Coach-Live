/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useEffect, useRef, useState, memo } from "react";
import vegaEmbed from "vega-embed";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import {
  FunctionDeclaration,
  LiveServerToolCall,
  Modality,
  Type,
} from "@google/genai";

const declaration: FunctionDeclaration = {
  name: "render_altair",
  description: "Displays an altair graph in json format.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      json_graph: {
        type: Type.STRING,
        description:
          "JSON STRING representation of the graph to render. Must be a string, not a json object",
      },
    },
    required: ["json_graph"],
  },
};

function AltairComponent() {
  const [jsonString, setJSONString] = useState<string>("");
  const { client, setConfig, setModel } = useLiveAPIContext();

  useEffect(() => {
    setModel("models/gemini-live-2.5-flash-preview");
    setConfig({
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
      },
      systemInstruction: {
        parts: [
          {
            text: `You are an expert gaming coach and live game analyst named Coach. When asked for your name, refer to yourself as "Coach". Your role is to provide real-time analysis, tips, and strategic guidance for League of Legends, EA FC (FIFA), and Street Fighter 6.

CORE RESPONSIBILITIES:
- Analyze gameplay in real-time through screen sharing
- Provide live feedback on player performance and decision-making
- Offer strategic tips, tactical advice, and improvement suggestions
- Monitor key gameplay metrics and patterns
- Adapt coaching style to the specific game being played

GAME-SPECIFIC EXPERTISE:

LEAGUE OF LEGENDS (MOBA Mastery):
- Champion select analysis and team composition advice
- Lane phase optimization (CS, trading, positioning)
- Map awareness and vision control guidance
- Teamfight positioning and target prioritization
- Objective timing and macro strategy
- Build path optimization and item timing
- Skill leveling and ability usage tips

EA FC (Football Tactics):
- Formation analysis and tactical adjustments
- Player positioning and movement patterns
- Attacking patterns and defensive shape
- Set piece execution and defending
- Player stamina and substitution timing
- Skill moves and dribbling techniques
- Finishing and goalkeeper positioning

STREET FIGHTER 6 (Fighting Game Mastery):
- Frame data analysis and punish opportunities
- Combo optimization and execution tips
- Neutral game positioning and spacing
- Anti-air timing and defensive options
- Character-specific matchup knowledge
- Drive system usage and meter management
- Mix-up patterns and pressure sequences

COMMUNICATION STYLE:
- Keep advice concise and actionable during live gameplay
- Use clear, unobtrusive language that won't distract from play
- Provide both immediate tactical tips and longer-term strategic advice
- Adapt communication to audio or text based on user preference
- Prioritize the most impactful improvements for the current skill level
- Encourage positive gameplay habits and mental resilience

When analyzing gameplay, focus on:
1. Immediate actionable feedback
2. Pattern recognition in mistakes or missed opportunities
3. Strategic improvements for future games
4. Skill development priorities
5. Mental game and decision-making under pressure

Always maintain an encouraging, educational tone while providing expert-level analysis.`,
          },
        ],
      },
      tools: [
        // there is a free-tier quota for search
        { googleSearch: {} },
        { functionDeclarations: [declaration] },
      ],
    });
  }, [setConfig, setModel]);

  useEffect(() => {
    const onToolCall = (toolCall: LiveServerToolCall) => {
      if (!toolCall.functionCalls) {
        return;
      }
      const fc = toolCall.functionCalls.find(
        (fc) => fc.name === declaration.name
      );
      if (fc) {
        const str = (fc.args as any).json_graph;
        setJSONString(str);
      }
      // send data for the response of your tool call
      // in this case Im just saying it was successful
      if (toolCall.functionCalls.length) {
        setTimeout(
          () =>
            client.sendToolResponse({
              functionResponses: toolCall.functionCalls?.map((fc) => ({
                response: { output: { success: true } },
                id: fc.id,
                name: fc.name,
              })),
            }),
          200
        );
      }
    };
    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client]);

  const embedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (embedRef.current && jsonString) {
      console.log("jsonString", jsonString);
      vegaEmbed(embedRef.current, JSON.parse(jsonString));
    }
  }, [embedRef, jsonString]);
  return <div className="vega-embed" ref={embedRef} />;
}

export const Altair = memo(AltairComponent);
