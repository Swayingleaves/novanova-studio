package com.novanovastudio.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import org.junit.jupiter.api.Test;

class AiTaskParameterReaderTest {

    @Test
    void readsIntegerStringsAsVideoDurations() {
        assertEquals(10, seconds("10"));
        assertEquals(10, seconds(" 10 "));
    }

    @Test
    void clampsNumbersAndIntegerStringsToTheSameRange() {
        assertEquals(10, seconds(10));
        assertEquals(15, seconds("25"));
        assertEquals(1, seconds("-2"));
    }

    @Test
    void fallsBackForMissingOrInvalidValues() {
        assertEquals(5, readSeconds(Map.of()));
        assertEquals(5, seconds(""));
        assertEquals(5, seconds("10.5"));
        assertEquals(5, seconds("2147483648"));
        assertEquals(5, seconds(true));
    }

    private static int seconds(Object value) {
        return readSeconds(Map.of("seconds", value));
    }

    private static int readSeconds(Map<String, Object> parameters) {
        return AiTaskParameterReader.intParameter(parameters, "seconds", 5, 1, 15);
    }
}
