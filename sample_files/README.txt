RELAY TRIP ANALYZER - SAMPLE FILES
======================================

Made-up events written in SEL's file formats so you can see how the program
works. Drag this whole folder onto the program (or click "Try sample files").

FILE                           FORMAT   WHAT HAPPENED                      WHAT TO LOOK FOR
Feeder12_AG_Zone1.cev          CEV      A-to-ground fault, Zone 1 trip     Clean result, High confidence, element timeline
Feeder12_settings.rdb          RDB      Feeder 12 relay settings           Trip equation and line length used for Feeder 12
Feeder12_history.his           HIS      Feeder 12 event history (4 rows)   Row 1 is linked to the CEV; beyond-line and reverse
                                                                           fault rows are flagged
Feeder12.ser                   SER      Feeder 12 element on/off log       Shown in the SER section
Line5_BC_Zone2_POTT.cev        CEV      B-C fault, Zone 2 + POTT trip      Trip explained by TRCOMM (communications-assisted)
Line5_ABC_Zone1.hdr            HDR      Three-phase fault, Zone 1          COMTRADE header summary is read
Feeder3_CG_51G.eve             EVE      C-to-ground, time-overcurrent      Text event report; flags missing settings
Feeder7_transfer_trip.sum      SUM      Trip with no fault, COMM target    Recognized as a likely transfer trip
Feeder14_underfrequency.txt    TXT      Underfrequency (81) trip           Off-nominal frequency flagged
Line5_Hill_BC_Zone1.cev        CEV      Other end of LINE 5, same fault    Paired with Line5_BC as a two-ended event
Feeder8_storm.sum              SUM      Two trips a minute after Feeder 3  Grouped with Feeder 3 as one incident (storm)
Feeder3_CG_51G.cfg / .dat      COMTRADE Feeder 3 fault, 32 samples/cycle   Waveform analysis: 51G U3 timing vs settings
Feeder3_settings.rdb           RDB      Feeder 3 relay settings            Used for the 51G evaluation (TD 2.00, U3)
Line22_other_maker.cfg / .dat  COMTRADE Another maker's relay, B-to-ground Summarized from the waveforms and its own
                                         fault, ground IOC trip             channel names (no SEL file needed)
Feeder9_AG_needs_review.cev    CEV      Deliberately inconsistent record   Several CHECK flags: wrong phase, beyond line,
                                                                           slow breaker

Notes
- Names, stations and numbers are invented.
- The .rdb is a simplified QuickSet-style database containing settings text.
