import { useState, useRef, useCallback } from 'react'

interface UseVoiceOptions {
  voiceAutoMode: boolean
  voiceRepliesEnabled: boolean
  onTranscript: (transcript: string) => void | Promise<void>
}

export function useVoice({ voiceAutoMode, voiceRepliesEnabled, onTranscript }: UseVoiceOptions) {
  const [listening, setListening] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [lastTranscript, setLastTranscript] = useState('')
  
  const voiceAutoRestartRef = useRef(false)
  const voicePendingRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recognitionRef = useRef<any>(null)

  const stopVoiceLoop = useCallback(() => {
    voiceAutoRestartRef.current = false
    if (voicePendingRestartRef.current) {
      clearTimeout(voicePendingRestartRef.current)
      voicePendingRestartRef.current = null
    }
    if (recognitionRef.current && typeof recognitionRef.current.stop === 'function') {
      try { recognitionRef.current.stop() } catch {}
    }
    setListening(false)
    setVoiceBusy(false)
  }, [])

  const startVoiceCapture = useCallback(async () => {
    setVoiceError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone access is not available in this environment.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      const chunks: Blob[] = []
      setListening(true)
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      
      recorder.onerror = () => {
        setVoiceError('Microphone recording failed.')
        setListening(false)
        stream.getTracks().forEach(track => track.stop())
      }
      
      recorder.onstop = async () => {
        setListening(false)
        stream.getTracks().forEach(track => track.stop())
        if (chunks.length === 0) {
          setVoiceError('No audio was captured. Try again and speak clearly.')
          return
        }
        try {
          setVoiceBusy(true)
          const blob = new Blob(chunks, { type: mimeType })
          const arrayBuffer = await blob.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          let binary = ''
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
          const base64 = btoa(binary)
          const { jobId } = await window.foldermind.transcribeVoice(base64)
          
          for (let attempt = 0; attempt < 60; attempt++) {
            const result = await window.foldermind.getVoiceResult(jobId)
            if (result.status === 'completed') {
              const transcript = (result.text || '').trim()
              setLastTranscript(transcript)
              setVoiceBusy(false)
              if (transcript) {
                await onTranscript(transcript)
              }
              return
            }
            if (result.status === 'failed') {
              setVoiceError(result.error || 'Voice transcription failed.')
              setVoiceBusy(false)
              return
            }
            await new Promise(resolve => setTimeout(resolve, 500))
          }
          setVoiceError('Voice transcription timed out.')
        } catch (error: any) {
          setVoiceError(error?.message || 'Unable to transcribe microphone input.')
        } finally {
          setVoiceBusy(false)
          if (voiceAutoRestartRef.current) {
            voicePendingRestartRef.current = setTimeout(() => { void startVoiceCapture() }, 700)
          }
        }
      }
      recognitionRef.current = recorder
      recorder.start()
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 7000)
    } catch (error: any) {
      setListening(false)
      setVoiceError(error?.message || 'Unable to start microphone input.')
    }
  }, [onTranscript])

  const toggleVoice = useCallback(async () => {
    setVoiceError(null)
    if (listening || voiceBusy) {
      stopVoiceLoop()
      return
    }
    voiceAutoRestartRef.current = voiceAutoMode
    await startVoiceCapture()
  }, [listening, voiceBusy, voiceAutoMode, startVoiceCapture, stopVoiceLoop])

  const speakText = useCallback(async (text: string) => {
    if (!voiceRepliesEnabled || !text.trim()) return
    try {
      const { jobId } = await window.foldermind.speakText(text)
      for (let attempt = 0; attempt < 60; attempt++) {
        const result = await window.foldermind.getSpeechResult(jobId)
        if (result.status === 'completed' && result.audioBase64) {
          const audio = new Audio(`data:${result.mimeType || 'audio/mpeg'};base64,${result.audioBase64}`)
          setVoiceSpeaking(true)
          audio.onended = () => setVoiceSpeaking(false)
          audio.onerror = () => setVoiceSpeaking(false)
          await audio.play()
          return
        }
        if (result.status === 'failed') {
          setVoiceError(result.error || 'Voice reply failed.')
          return
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      setVoiceError('Voice reply timed out.')
    } catch (error: any) {
      setVoiceError(error?.message || 'Unable to play voice reply.')
    }
  }, [voiceRepliesEnabled])

  return {
    listening,
    voiceBusy,
    voiceSpeaking,
    voiceError,
    lastTranscript,
    setVoiceError,
    toggleVoice,
    speakText,
    stopVoiceLoop
  }
}
