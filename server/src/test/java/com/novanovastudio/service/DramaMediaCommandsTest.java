package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class DramaMediaCommandsTest {

    @Test
    void completionReplyTellsTheUserTheyCanContinue() {
        assertEquals("少年、强化者已经生成完成了。您可以继续跟我对话，比如调整外形、生成其他图片，或继续做分镜和视频。",
                DramaMediaCommands.completionReply(List.of("少年", "强化者"), List.of("success", "success")));
    }
}
