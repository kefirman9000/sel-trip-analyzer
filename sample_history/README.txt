RELAY TRIP HISTORY - SAMPLE FILES
================================

Two years (Nov 2024 to Oct 2026) of made-up relay files from five substations,
kept in folders by station and relay. Drag the whole sample_history folder (or
Relay_history_samples.zip) onto the Relay Trip History page, or click "Try samples".

WHERE            WHAT HAPPENED                                     WHAT THE HISTORY PAGE SHOULD SHOW
FEEDER 12        A-G faults at ~4.1-4.4 miles since June 2026,     Top problem location: recurring ground faults, a fault
(APEX SUB)       more often each month, two locked out             hot spot near 42% of the line, trend increasing
FEEDER 8         Many storm faults in summer 2025, trees trimmed   Recurring faults and lockouts in 2025, trend decreasing
(OAK HILL SUB)   in Dec 2025, quieter since                        (the sample work log marks the trimming)
LINE 5           Faults seen from both ends; the RIVER SUB         Recurring slow breaker clearing, 5.5 -> 7.75 cycles
(RIVER/HILL)     breaker takes longer to open every time           (CEV files, with settings)
FEEDER 7         Four transfer trips with no fault in spring 2026  Recurring transfer trips, stopped since May
FEEDER 9         Three trips with no fault and no reason, 2025     Recurring "trip with no fault found"
FEEDER 11        Faults all along, plus three faults behind the    Recurring negative-location faults (behind the relay)
(MILL ROAD SUB)  relay in spring 2026
FEEDER 14        Two underfrequency load-shedding trips            Frequency trips, nothing recurring
FEEDER 3         Three faults in two years                         Low in the ranking

Each relay folder also has its settings (.set). FEEDER 12 and FEEDER 8 have an
event history (.his) that repeats events already in the .sum files: each event
should be counted once.
