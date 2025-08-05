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

import cn from "classnames";
import { memo, ReactNode, RefObject, useEffect, useRef, useState } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { UseMediaStreamResult } from "../../hooks/use-media-stream-mux";
import { useScreenCapture } from "../../hooks/use-screen-capture";
import { useWebcam } from "../../hooks/use-webcam";
import { AudioRecorder } from "../../lib/audio-recorder";
import AudioPulse from "../audio-pulse/AudioPulse";
import "./control-tray.scss";
import SettingsDialog from "../settings-dialog/SettingsDialog";

type Game = "EAFC" | "League of Legends" | "Street Fighter 6" | null;

type MediaStreamButtonProps = {
  isStreaming: boolean;
  onIcon: string;
  offIcon: string;
  start: () => void;
  stop: () => void;
  disabled?: boolean;
};

export type ControlTrayProps = {
  videoRef: RefObject<HTMLVideoElement>;
  children?: ReactNode;
  supportsVideo: boolean;
  onVideoStreamChange?: (stream: MediaStream | null) => void;
  enableEditingSettings?: boolean;
  videoStream: MediaStream | null;
  activeGame: Game;
};

const MediaStreamButton = memo(
  ({
    isStreaming,
    onIcon,
    offIcon,
    start,
    stop,
    disabled = false,
  }: MediaStreamButtonProps) =>
    isStreaming ? (
      <button className="action-button" onClick={stop}>
        <span className="material-symbols-outlined">{onIcon}</span>
      </button>
    ) : (
      <button
        className={cn("action-button", { disabled })}
        onClick={disabled ? undefined : start}
        disabled={disabled}
        title={
          disabled ? "Select a game first to enable screen sharing" : undefined
        }
      >
        <span className="material-symbols-outlined">{offIcon}</span>
      </button>
    ),
);

function ControlTray({
  videoRef,
  children,
  onVideoStreamChange = () => {},
  supportsVideo,
  enableEditingSettings,
  videoStream,
  activeGame,
}: ControlTrayProps) {
  const videoStreams = [useWebcam(), useScreenCapture()];
  const [activeVideoStream, setActiveVideoStream] =
    useState<MediaStream | null>(null);
  const [webcam, screenCapture] = videoStreams;
  const [inVolume, setInVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [muted, setMuted] = useState(false);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const lastVolumeRef = useRef(0);
  
  // Track user speaking state and pause system commands during conversation
  const [lastUserSpeechTime, setLastUserSpeechTime] = useState<number>(0);

  // FIX: Restore the destructuring of all needed functions/variables
  const { client, connected, connect, disconnect, volume } =
    useLiveAPIContext();

  // Refs to track current state for heartbeat (avoid closure issues)
  const currentStateRef = useRef({
    connected: false,
    activeGame: null as Game,
    videoStream: null as MediaStream | null,
    activeVideoStream: null as MediaStream | null,
    isAISpeaking: false,
    isUserSpeaking: false,
    lastUserSpeechTime: 0
  });

  // Update refs whenever state changes
  useEffect(() => {
    currentStateRef.current = {
      connected,
      activeGame,
      videoStream,
      activeVideoStream,
      isAISpeaking,
      isUserSpeaking,
      lastUserSpeechTime
    };
  }, [connected, activeGame, videoStream, activeVideoStream, isAISpeaking, isUserSpeaking, lastUserSpeechTime]);

  // Track AI speaking state based on volume
  useEffect(() => {
    setIsAISpeaking(volume > 0.01);
  }, [volume]);

  // Track previous screen sharing state to detect changes
  const [wasScreenSharing, setWasScreenSharing] = useState(false);

  useEffect(() => {
    const volumeThreshold = 0.015; // Slightly more sensitive
    const currentlyUserSpeaking = inVolume > volumeThreshold;

    if (currentlyUserSpeaking !== isUserSpeaking) {
      setIsUserSpeaking(currentlyUserSpeaking);

      // Update last speech time when user starts speaking
      if (currentlyUserSpeaking) {
        setLastUserSpeechTime(Date.now());
      }
    }
    lastVolumeRef.current = inVolume;
  }, [inVolume, isUserSpeaking]);

  // Bulletproof Screen Sharing Detection with Comprehensive Validation
  useEffect(() => {
    let tickInterval: NodeJS.Timeout;
    let validationInterval: NodeJS.Timeout;

    // Enhanced validation function with detailed debugging
    const validateScreenSharingState = (): boolean => {
      console.log("🔍 VALIDATION DEBUG:", {
        screenCaptureStreaming: screenCapture.isStreaming,
        screenCaptureStream: !!screenCapture.stream,
        webcamStreaming: webcam.isStreaming,
        webcamStream: !!webcam.stream,
        videoStream: !!videoStream,
        activeVideoStream: !!activeVideoStream
      });
      
      // Primary validation: Check if any capture streams are active
      const isScreenCaptureActive = screenCapture.isStreaming && screenCapture.stream;
      const isWebcamActive = webcam.isStreaming && webcam.stream;
      
      // Secondary validation: Check if video streams exist
      const hasActiveVideoStream = videoStream || activeVideoStream;
      
      // Screen sharing is active if either capture method is working OR we have video streams
      const isActiveScreenSharing = isScreenCaptureActive || isWebcamActive || hasActiveVideoStream;
      
      if (isActiveScreenSharing) {
        console.log("✅ VALIDATION PASSED: Screen sharing is active");
        return true;
      } else {
        console.log("❌ VALIDATION FAILED: No screen sharing detected");
        return false;
      }
    };

    // Continuously validate screen sharing state every 5 seconds (less frequent to avoid false negatives)
    validationInterval = setInterval(() => {
      const isActuallyScreenSharing = validateScreenSharingState();
      
      // Only force stop if we've been sharing for at least 5 seconds and now validation fails
      // This prevents premature stopping during initialization
      if (wasScreenSharing && !isActuallyScreenSharing) {
        console.log("VALIDATION FAILED: Forcing screen sharing stop due to invalid state");
        setWasScreenSharing(false);
        
        // Force stop all streams
        if (screenCapture.isStreaming) {
          screenCapture.stop();
        }
        if (webcam.isStreaming) {
          webcam.stop();
        }
        
        // Notify systems
        window.dispatchEvent(
          new CustomEvent("screenSharingStopped", {
            detail: { game: activeGame },
          }),
        );
        
        if (client && connected && !muted) {
          client.send([{ text: `[SYSTEM_NOTIFICATION] Screen sharing has been automatically stopped due to validation failure.` }]);
        }
      }
    }, 5000);

    const isCurrentlyScreenSharing = validateScreenSharingState();

    // Detect screen sharing state changes and notify CoachSetup
    if (isCurrentlyScreenSharing && !wasScreenSharing) {
      // Screen sharing just started - give more time for streams to stabilize
      setTimeout(() => {
        if (validateScreenSharingState()) {
          console.log(`Screen sharing started for ${activeGame}. Notifying CoachSetup.`);
          window.dispatchEvent(
            new CustomEvent("screenSharingStarted", {
              detail: { game: activeGame },
            }),
          );
          setWasScreenSharing(true);

          // Immediately notify AI that screen sharing has started with comprehensive context
          if (client && connected && !muted) {
            const getGameAnalysisInstructions = (game: Game) => {
              switch (game) {
                case "EAFC":
                  return `
**GAMEPLAY ANALYSIS FOCUS:**
- **Tactical Positioning**: Monitor player formations, defensive lines, pressing triggers
- **Decision Making**: Analyze passing choices, shooting opportunities, defensive timing
- **Technical Skills**: Evaluate first touches, skill move execution, defensive tackles
- **Game Management**: Track stamina levels, substitution needs, formation adjustments
- **Set Pieces**: Provide immediate guidance on free kicks, corners, penalties, throw-ins
- **Critical Moments**: React to goals, saves, near misses, counter-attacks, big tackles

**COACHING APPROACH:**
- Give DIRECT tactical commands: "Press higher!", "Drop deeper!", "Switch the play!"
- Provide IMMEDIATE reactions to key moments: "Great save!", "Take the shot!", "Perfect timing!"
- Offer STRATEGIC guidance: "Time for a substitution", "Change formation", "Focus on the wings"
- NEVER ask questions like "What's your strategy?" - instead TELL them what to do
- Be like a demanding football coach giving orders from the sideline`;

                case "League of Legends":
                  return `
**GAMEPLAY ANALYSIS FOCUS:**
- **Laning Phase**: Monitor CS efficiency, trade patterns, wave management, recall timing
- **Map Awareness**: Track enemy positions, ward placements, objective timings
- **Team Fighting**: Analyze positioning, target focus, ability usage, engage timing
- **Macro Decisions**: Evaluate roaming, objective calls, item builds, power spike timing
- **Mechanical Execution**: Assess combo execution, skillshot accuracy, reaction timing
- **Vision Control**: Monitor ward placements, sweep patterns, objective vision

**COACHING APPROACH:**
- Give DIRECT commands: "CS that minion!", "Trade now!", "Ward river!", "Back off!"
- Provide IMMEDIATE calls: "Dragon time!", "Baron now!", "Engage!", "Disengage!"
- Offer STRATEGIC guidance: "Build armor next", "Group mid", "Split push top"
- NEVER ask questions like "What's your plan?" - instead TELL them what to do
- Be like an aggressive coach calling plays in real-time`;

                case "Street Fighter 6":
                  return `
**GAMEPLAY ANALYSIS FOCUS:**
- **Neutral Game**: Monitor spacing, whiff punishes, approach timing, footsie patterns
- **Combo Execution**: Analyze damage optimization, drop punishes, consistency issues
- **Defense**: Track blocking patterns, anti-air timing, throw tech success, escape options
- **Drive System**: Monitor meter usage, Drive Rush timing, Burnout prevention
- **Adaptation**: Observe pattern recognition, counter-strategies, mental adjustments
- **Pressure Sequences**: Evaluate mix-up effectiveness, frame trap timing, reset opportunities

**COACHING APPROACH:**
- Give DIRECT commands: "Anti-air now!", "Punish that!", "Block low!", "Drive Rush!"
- Provide IMMEDIATE corrections: "That was unsafe!", "Perfect punish!", "Good spacing!"
- Offer STRATEGIC guidance: "Save meter for super", "Change your approach", "Adapt your defense"
- NEVER ask questions like "How do you feel about this matchup?" - instead TELL them what to do
- Be like a stern fighting game coach demanding precise execution`;

                default:
                  return "Focus on immediate tactical decisions and provide direct coaching commands.";
              }
            };

            const screenShareNotification = `[SYSTEM_NOTIFICATION] SCREEN SHARING NOW ACTIVE - ${activeGame} COACHING MODE ENGAGED

I have successfully started screen sharing my ${activeGame} gameplay. You can now see my screen in real-time and should provide live coaching analysis.

**COACHING MODE ACTIVATED:**
- You are now watching live ${activeGame} gameplay footage
- Provide IMMEDIATE tactical guidance and corrections
- React to exciting moments and key gameplay events
- Give DIRECT commands and instructions (never ask what I want to focus on)
- Be authoritative and decisive in your coaching
- Only speak when you see something worth coaching about

${getGameAnalysisInstructions(activeGame)}

**IMMEDIATE ACTION:** Start analyzing my gameplay and provide coaching when you see opportunities for improvement or exciting moments worth commenting on. Be direct, confident, and helpful.`;

            client.send([{ text: screenShareNotification }]);
            console.log("Sent comprehensive screen sharing start notification to AI");
          }
        } else {
          console.log("Screen sharing validation failed on startup. Not starting heartbeat.");
        }
      }, 1000); // Give 1 second for stream to stabilize
    } else if (!isCurrentlyScreenSharing && wasScreenSharing) {
      // Screen sharing just stopped
      console.log(`Screen sharing stopped. Notifying CoachSetup.`);
      window.dispatchEvent(
        new CustomEvent("screenSharingStopped", {
          detail: { game: activeGame },
        }),
      );
      setWasScreenSharing(false);

      // Notify AI that screen sharing has stopped
      if (client && connected && !muted) {
        const screenShareStoppedNotification = `[SYSTEM_NOTIFICATION] I have stopped screen sharing. You can no longer see my screen.`;
        client.send([{ text: screenShareStoppedNotification }]);
        console.log("Sent screen sharing stop notification to AI");
      }
    }

    if (isCurrentlyScreenSharing) {
      console.log(`Bulletproof screen sharing active for ${activeGame}. Starting gameplay analysis heartbeat.`);
      console.log("🚀 HEARTBEAT STARTING - Setting up 10-second interval");
      
      tickInterval = setInterval(() => {
        console.log("🔄 HEARTBEAT TICK - Starting new cycle");
        
        // Get current state from refs (avoids closure issues)
        const current = currentStateRef.current;
        
        console.log("HEARTBEAT VALIDATION - Checking screen sharing:", {
          screenCaptureStreaming: screenCapture.isStreaming,
          webcamStreaming: webcam.isStreaming,
          isScreenSharing: screenCapture.isStreaming || webcam.isStreaming
        });

        // Only validate screen sharing is active
        if (!screenCapture.isStreaming && !webcam.isStreaming) {
          console.log("❌ HEARTBEAT VALIDATION FAILED: No screen sharing active");
          return;
        }

        console.log("✅ HEARTBEAT VALIDATION PASSED: All checks successful");

        // Only send system command if neither AI nor user is speaking AND enough time has passed since last user speech
        const isSomeoneCurrentlySpeaking = current.isAISpeaking || current.isUserSpeaking;
        const timeSinceLastUserSpeech = Date.now() - current.lastUserSpeechTime;
        const shouldAllowSystemCommand = timeSinceLastUserSpeech > 10000; // 10 seconds

        console.log(`🎤 DETAILED SPEECH CHECK:`, {
          currentAISpeaking: current.isAISpeaking,
          currentUserSpeaking: current.isUserSpeaking,
          actualAISpeaking: isAISpeaking,
          actualUserSpeaking: isUserSpeaking,
          isSomeoneCurrentlySpeaking,
          timeSinceLastUserSpeech: Math.round(timeSinceLastUserSpeech / 1000),
          shouldAllowSystemCommand,
          inVolume,
          volume
        });
        
        if (!isSomeoneCurrentlySpeaking && shouldAllowSystemCommand) {
          console.log("📤 SENDING COACHING INSTRUCTION - All speech conditions met");
          const getGameSpecificExcitingMoments = (game: Game) => {
            switch (game) {
              case "EAFC":
                return `
**EXCITING MOMENTS TO ALWAYS COMMENT ON:**
- **Set pieces**: Free kicks, corners, penalties, throw-ins - ALWAYS provide immediate coaching
- **Goals**: Scoring opportunities, actual goals, near misses - Get excited and celebrate/encourage
- **Key saves**: Goalkeeper saves, defensive blocks - Acknowledge great plays
- **Big plays**: Skill moves, tackles, through balls, counter-attacks - Provide immediate reaction
- **Critical situations**: Red cards, injuries, substitutions - Strategic guidance
- **Tactical changes**: Formation switches, pressing intensity changes - Explain impact

**IMMEDIATE REACTIONS FOR EAFC:**
- Free kicks: "Perfect position! Aim for the top corner!" "Get your best free kick taker on this!"
- Penalties: "Stay calm, pick your corner!" "Keeper's diving left usually!"
- Goals: "GOAL! What a finish!" "Great build-up play there!"
- Near misses: "So close! Keep shooting!" "Next time place it lower!"
- Counter-attacks: "GO GO GO! This is your moment!" "Quick pass forward!"
- Skill moves: "Beautiful skill move!" "That's how you beat a defender!"`;

              case "League of Legends":
                return `
**EXCITING MOMENTS TO ALWAYS COMMENT ON:**
- **Kills**: Solo kills, team fight kills, outplays - Celebrate and provide immediate feedback
- **Team fights**: Major team fights, positioning plays - Direct tactical commands
- **Objectives**: Dragon/Baron attempts, steals, securing - Strategic calls
- **Big plays**: Flashes, ultimates, game-changing moments - Immediate reaction
- **Ganks**: Successful ganks, escapes, counter-ganks - Quick tactical advice
- **Power spikes**: Item completions, level advantages - Strategic timing calls

**IMMEDIATE REACTIONS FOR LEAGUE:**
- Kills: "Nice kill!" "Perfect execution!" "Great combo!"
- Team fights: "FIGHT! Focus the carry!" "Disengage now!" "Perfect positioning!"
- Objectives: "Baron time!" "Take that dragon!" "Secure the objective!"
- Big plays: "INSANE play!" "What a dodge!" "Perfect ultimate!"
- Ganks: "Gank incoming!" "Turn on them!" "Escape now!"
- Power spikes: "You just hit your power spike!" "Time to fight!"`;

              case "Street Fighter 6":
                return `
**EXCITING MOMENTS TO ALWAYS COMMENT ON:**
- **Perfect combos**: Maximum damage combos, technical execution - Celebrate skill
- **Counter hits**: Big counter hit confirms, punish opportunities - Immediate coaching
- **Comebacks**: Health comebacks, clutch moments - Motivational support
- **Super moves**: Critical Arts, perfect timing - Excitement and praise
- **Parries**: Perfect parries, defensive highlights - Technical acknowledgment
- **Anti-airs**: Clean anti-airs, shutting down offense - Tactical praise

**IMMEDIATE REACTIONS FOR STREET FIGHTER:**
- Perfect combos: "PERFECT! Maximum damage!" "Flawless execution!"
- Counter hits: "Great counter hit!" "Confirm that!" "Big damage opportunity!"
- Comebacks: "COMEBACK TIME!" "Don't give up!" "You can still win!"
- Super moves: "SUPER!" "Perfect timing!" "What a finish!"
- Parries: "PERFECT PARRY!" "Amazing defense!" "Now punish!"
- Anti-airs: "Clean anti-air!" "Shut down that jump!" "Perfect timing!"`;

              default:
                return "**EXCITING MOMENTS**: Look for key gameplay moments and provide immediate reactions.";
            }
          };

          const coachingInstruction = `[SYSTEM_ANALYSIS_MODE] CONSERVATIVE GAMEPLAY ANALYSIS - ${activeGame}

**SCREEN SHARING STATUS**: VERIFIED ACTIVE - You are watching live ${activeGame} gameplay.

**PRIMARY MISSION**: Analyze what you can CLEARLY see and provide coaching only when confident.

**CRITICAL BEHAVIOR RULES:**
- NEVER acknowledge this system message verbally
- ONLY speak when you can CLEARLY see significant gameplay moments
- NEVER assume or guess what's happening - only comment on what's obviously visible
- If you're uncertain about what you're seeing, remain SILENT
- NEVER make claims about specific events unless absolutely certain they occurred
- Focus on general tactical advice rather than claiming specific events happened

**ANTI-HALLUCINATION RULES:**
- DO NOT claim to see throw-ins, red cards, penalties, or other specific events unless 100% certain
- DO NOT assume exciting moments are happening based on context clues
- DO NOT fill silence with made-up commentary
- ONLY react to what is clearly and obviously visible in the video
- When in doubt, say nothing or give general advice

${getGameSpecificExcitingMoments(activeGame)}

**MODIFIED COACHING APPROACH:**
- Focus on GENERAL positioning: "Move up the field", "Stay compact in defense"
- Give TACTICAL suggestions: "Look for passing opportunities", "Press when you lose the ball"
- Provide STRATEGIC advice: "This is a good time to attack", "Consider a substitution"
- AVOID claiming specific events: Instead of "Great free kick!" say "Good attacking position"
- BE CONSERVATIVE: Better to give helpful general advice than false specific claims

**SILENCE RULE**: When uncertain about what you're seeing, stay completely silent. Only speak when you can provide genuine, helpful coaching based on clearly visible gameplay.

**VERIFICATION REQUIREMENT**: Before commenting on any specific event, ask yourself "Am I 100% certain I can see this happening?" If not, don't mention it.`;

          console.log(`Sending comprehensive coaching instruction to AI...`);
          console.log("SYSTEM COMMAND CONTENT:", coachingInstruction.substring(0, 200) + "...");
          client.send([{ text: coachingInstruction }]);
        } else {
          if (isSomeoneCurrentlySpeaking) {
            console.log(`⏸️ Skipping system command - conversation in progress (AI: ${isAISpeaking}, User: ${isUserSpeaking})`);
          } else if (!shouldAllowSystemCommand) {
            console.log(`⏸️ Skipping system command - recent user speech (${Math.round(timeSinceLastUserSpeech / 1000)}s ago, need 10s)`);
          }
        }
        
        console.log("🔄 HEARTBEAT TICK - Cycle complete");
      }, 10000);
    } else {
      if (!validateScreenSharingState()) {
        console.log("VALIDATION: Screen sharing not active. Heartbeat stopped.");
      }
    }

    return () => {
      if (tickInterval) {
        console.log("🛑 HEARTBEAT STOPPING - Clearing intervals");
        clearInterval(tickInterval);
      }
      if (validationInterval) {
        clearInterval(validationInterval);
      }
    };
  }, [
    connected,
    client,
    muted,
    videoStream,
    activeGame,
    activeVideoStream,
    screenCapture.isStreaming,
    webcam.isStreaming,
    wasScreenSharing,
    isAISpeaking,
    isUserSpeaking,
    lastUserSpeechTime,
    screenCapture,
    webcam,
    videoRef,
  ]);

  useEffect(() => {
    if (!connected && connectButtonRef.current) {
      connectButtonRef.current.focus();
    }
  }, [connected]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--volume",
      `${Math.max(5, Math.min(inVolume * 200, 8))}px`,
    );
  }, [inVolume]);

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([
        {
          mimeType: "audio/pcm;rate=16000",
          data: base64,
        },
      ]);
    };
    if (connected && !muted && audioRecorder) {
      audioRecorder.on("data", onData).on("volume", setInVolume).start();
    } else {
      audioRecorder.stop();
    }
    return () => {
      audioRecorder.off("data", onData).off("volume", setInVolume);
    };
  }, [connected, client, muted, audioRecorder]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeVideoStream;
    }

    let timeoutId = -1;

    function sendVideoFrame() {
      const video = videoRef.current;
      const canvas = renderCanvasRef.current;

      if (!video || !canvas) {
        return;
      }

      const ctx = canvas.getContext("2d")!;
      canvas.width = video.videoWidth * 0.25;
      canvas.height = video.videoHeight * 0.25;
      if (canvas.width + canvas.height > 0) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 1.0);
        const data = base64.slice(base64.indexOf(",") + 1, Infinity);
        client.sendRealtimeInput([{ mimeType: "image/jpeg", data }]);
      }
      if (connected) {
        timeoutId = window.setTimeout(sendVideoFrame, 1000 / 0.5);
      }
    }
    if (connected && activeVideoStream !== null) {
      requestAnimationFrame(sendVideoFrame);
    }
    return () => {
      clearTimeout(timeoutId);
    };
  }, [connected, activeVideoStream, client, videoRef]);

  const changeStreams = (next?: UseMediaStreamResult) => async () => {
    console.log("🎬 SCREEN SHARE BUTTON CLICKED:", {
      nextStream: next?.constructor.name,
      isScreenCapture: next === screenCapture,
      currentScreenCaptureStreaming: screenCapture.isStreaming,
      activeGame: activeGame
    });
    
    if (next) {
      try {
        console.log("🚀 Starting stream...");
        const mediaStream = await next.start();
        console.log("✅ Stream started successfully:", {
          streamId: mediaStream?.id,
          streamActive: mediaStream?.active,
          tracks: mediaStream?.getTracks().length
        });
        setActiveVideoStream(mediaStream);
        onVideoStreamChange(mediaStream);
      } catch (error) {
        console.error("❌ Failed to start stream:", error);
      }
    } else {
      console.log("🛑 Stopping all streams");
      setActiveVideoStream(null);
      onVideoStreamChange(null);
    }

    videoStreams.filter((msr) => msr !== next).forEach((msr) => msr.stop());
  };

  return (
    <section className="control-tray">
      <canvas style={{ display: "none" }} ref={renderCanvasRef} />
      <nav className={cn("actions-nav", { disabled: !connected })}>
        <button
          className={cn("action-button mic-button")}
          onClick={() => setMuted(!muted)}
        >
          {!muted ? (
            <span className="material-symbols-outlined filled">mic</span>
          ) : (
            <span className="material-symbols-outlined filled">mic_off</span>
          )}
        </button>

        <div className="action-button no-action outlined">
          <AudioPulse volume={volume} active={connected} hover={false} />
        </div>

        {supportsVideo && (
          <>
            <MediaStreamButton
              isStreaming={screenCapture.isStreaming}
              start={changeStreams(screenCapture)}
              stop={changeStreams()}
              onIcon="cancel_presentation"
              offIcon="present_to_all"
              disabled={!activeGame}
            />
            <MediaStreamButton
              isStreaming={webcam.isStreaming}
              start={changeStreams(webcam)}
              stop={changeStreams()}
              onIcon="videocam_off"
              offIcon="videocam"
              disabled={!activeGame}
            />
          </>
        )}
        {children}
      </nav>

      <div className={cn("connection-container", { connected })}>
        <div className="connection-button-container">
          <button
            ref={connectButtonRef}
            className={cn("action-button connect-toggle", { connected })}
            onClick={connected ? disconnect : connect}
          >
            <span className="material-symbols-outlined filled">
              {connected ? "pause" : "play_arrow"}
            </span>
          </button>
        </div>
        <span className="text-indicator">Streaming</span>
      </div>
      {enableEditingSettings ? <SettingsDialog /> : ""}
    </section>
  );
}

export default memo(ControlTray);